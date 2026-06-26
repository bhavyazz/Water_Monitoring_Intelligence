"""
source_engine.py — Dual-Evidence Pollution Source Identification

Evidence Layer 1 (60% weight): Chemical fingerprinting via z-score
distance in normalized parameter space between observed reading and
each source profile centroid.

Evidence Layer 2 (40% weight): OSM geospatial proximity analysis.
Queries OpenStreetMap Overpass API for land use features within 300m
of the reading location.

Graceful fallback: if Overpass fails/times out, chemical-only scoring
is returned with proximity_unavailable flag.
"""

from __future__ import annotations
import logging
import math
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

# Overpass blocks the default python-requests User-Agent with HTTP 406.
# A descriptive UA is required per Overpass usage policy.
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_HEADERS = {
    "User-Agent": "AquaVision/1.0 (water-quality-monitoring; RVCE Bangalore)"
}

SOURCE_PROFILES = {
    "industrial_discharge": {
        "tds_center": 800, "tds_std": 200,
        "turbidity_center": 10, "turbidity_std": 8,
        "ph_center": 5.5, "ph_std": 1.0,
        "ph_is_abnormal": True,
        "osm_tags": ["landuse=industrial", "man_made=works", "man_made=wastewater_plant"],
        "osm_weight": 2,
        "label": "Industrial Discharge",
        "description": "Industrial effluent — elevated TDS with abnormal pH",
    },
    "sewage_contamination": {
        "tds_center": 520, "tds_std": 120,
        "turbidity_center": 14, "turbidity_std": 5,
        "ph_center": 7.3, "ph_std": 0.4,
        "ph_is_abnormal": False,
        "osm_tags": ["landuse=residential", "man_made=wastewater_plant", "waterway=drain"],
        "osm_weight": 2,
        "label": "Sewage Contamination",
        "description": "Domestic sewage — moderate TDS, elevated turbidity, near-neutral pH",
    },
    "agricultural_runoff": {
        "tds_center": 340, "tds_std": 80,
        "turbidity_center": 24, "turbidity_std": 8,
        "ph_center": 7.9, "ph_std": 0.4,
        "ph_is_abnormal": False,
        "osm_tags": ["landuse=farmland", "landuse=orchard", "landuse=meadow"],
        "osm_weight": 2,
        "label": "Agricultural Runoff",
        "description": "Agricultural runoff — high turbidity from soil erosion, alkaline pH",
    },
    "solid_waste_leachate": {
        "tds_center": 950, "tds_std": 200,
        "turbidity_center": 35, "turbidity_std": 10,
        "ph_center": 6.2, "ph_std": 0.8,
        "ph_is_abnormal": True,
        "osm_tags": ["amenity=waste_disposal", "landuse=landfill"],
        "osm_weight": 2,
        "label": "Solid Waste Leachate",
        "description": "Solid waste leachate — very high TDS and turbidity, variable pH",
    },
}


def _chemical_distance(tds, turbidity, ph, profile):
    d_tds = abs(tds - profile["tds_center"]) / profile["tds_std"]
    d_turb = abs(turbidity - profile["turbidity_center"]) / profile["turbidity_std"]
    d_ph = abs(ph - profile["ph_center"]) / profile["ph_std"]
    ph_bonus = 0.0
    if profile["ph_is_abnormal"] and (ph < 6.5 or ph > 8.5):
        ph_bonus = -0.5
    return math.sqrt(d_tds ** 2 + d_turb ** 2 + d_ph ** 2) + ph_bonus


class SourceIdentifier:

    def __init__(self, osm_radius: int = 500, osm_timeout: int = 15):
        self.osm_radius = osm_radius
        self.osm_timeout = osm_timeout

    def identify(
        self,
        tds: float,
        turbidity: float,
        ph: float,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        skip_osm: bool = False,
        precomputed_osm: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Identify pollution source from sensor readings.

        Args:
            precomputed_osm: If provided, skip OSM query and use these
                pre-filtered results: {"scores": {...}, "features": [...]}
                Used by async pipeline to pass upstream-filtered OSM data.
        """
        chemical_scores = self._chemical_scores(tds, turbidity, ph)

        osm_scores = {}
        osm_features = []
        proximity_available = False
        upstream_filtered = False

        if precomputed_osm is not None:
            osm_scores = precomputed_osm.get("scores", {})
            osm_features = precomputed_osm.get("features", [])
            upstream_filtered = precomputed_osm.get("upstream_filtered", False)
            proximity_available = len(osm_features) > 0 or any(v > 0 for v in osm_scores.values())
        elif lat is not None and lon is not None and not skip_osm:
            try:
                osm_scores, osm_features = self._osm_scores(lat, lon)
                proximity_available = True
            except Exception as e:
                logger.warning("OSM Overpass query failed: %s", e)

        if proximity_available:
            final = {}
            for key in SOURCE_PROFILES:
                final[key] = 0.60 * chemical_scores.get(key, 0) + 0.40 * osm_scores.get(key, 0)
        else:
            final = dict(chemical_scores)

        total = sum(final.values())
        if total > 0:
            normalized = {k: round(v / total, 4) for k, v in final.items()}
        else:
            normalized = {k: round(1.0 / len(final), 4) for k in final}

        ranked = sorted(normalized.items(), key=lambda x: x[1], reverse=True)
        primary_key = ranked[0][0]
        primary_score = ranked[0][1]
        secondary_key = ranked[1][0] if len(ranked) > 1 else None
        secondary_score = ranked[1][1] if len(ranked) > 1 else 0

        ambiguous = (secondary_score > 0 and primary_score - secondary_score < 0.15)

        profile = SOURCE_PROFILES[primary_key]
        evidence = self._build_evidence(tds, turbidity, ph, primary_key)

        filter_note = ""
        if upstream_filtered:
            filter_note = "OSM features filtered to upstream-only (flow-direction aware). "

        result = {
            "source": profile["label"],
            "source_key": primary_key,
            "confidence": round(primary_score, 4),
            "description": profile["description"],
            "chemical_evidence": evidence,
            "scores": {SOURCE_PROFILES[k]["label"]: v for k, v in normalized.items()},
            "chemical_scores": {SOURCE_PROFILES[k]["label"]: round(v, 4)
                                for k, v in chemical_scores.items()},
            "proximity_available": proximity_available,
            "upstream_filtered": upstream_filtered,
            "osm_features_found": osm_features,
            "ambiguous": ambiguous,
            "methodology_note": (
                "Dual-evidence source identification: chemical fingerprinting (z-score distance "
                "from literature-derived profile centroids) weighted 60%, OSM geospatial proximity "
                f"analysis (radius={self.osm_radius}m) weighted 40%. "
                + filter_note
                + ("OSM data unavailable — chemical-only scoring applied. " if not proximity_available else "")
                + "Limitation: 4-parameter space is degenerate — multiple sources can produce "
                "similar signatures. Fecal coliform, heavy metals, and nutrient ratios would "
                "improve discrimination."
            ),
        }

        if ambiguous and secondary_key:
            sec_profile = SOURCE_PROFILES[secondary_key]
            result["secondary_source"] = sec_profile["label"]
            result["secondary_confidence"] = round(secondary_score, 4)
            result["ambiguity_note"] = (
                f"Top two sources ({profile['label']} vs {sec_profile['label']}) "
                f"differ by <0.15 — classification is ambiguous with available parameters."
            )

        return result

    def _chemical_scores(self, tds, turbidity, ph) -> Dict[str, float]:
        distances = {}
        for key, profile in SOURCE_PROFILES.items():
            distances[key] = _chemical_distance(tds, turbidity, ph, profile)

        max_dist = max(distances.values()) if distances else 1.0
        if max_dist == 0:
            max_dist = 1.0
        similarities = {k: max(0, 1 - d / max_dist) for k, d in distances.items()}

        total = sum(similarities.values())
        if total > 0:
            return {k: v / total for k, v in similarities.items()}
        return {k: 1.0 / len(similarities) for k in similarities}

    def query_osm_features(self, lat: float, lon: float) -> List[Dict]:
        """Query Overpass for land-use features within radius (cached, mirrored)."""
        from analysis.osm_client import overpass_post, cache_get, cache_put

        cache_key = f"feat:{round(lat, 4)},{round(lon, 4)},{self.osm_radius}"
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

        query = (
            f"[out:json][timeout:{self.osm_timeout}];\n"
            "(\n"
            f'  way["landuse"~"industrial|farmland|orchard|residential|landfill"](around:{self.osm_radius},{lat},{lon});\n'
            f'  node["amenity"="waste_disposal"](around:{self.osm_radius},{lat},{lon});\n'
            f'  way["man_made"~"works|wastewater_plant"](around:{self.osm_radius},{lat},{lon});\n'
            f'  way["waterway"~"drain|ditch"](around:{self.osm_radius},{lat},{lon});\n'
            ");\n"
            "out center;"
        )

        data = overpass_post(query, timeout=self.osm_timeout)
        elements = data.get("elements", [])
        cache_put(cache_key, elements)
        return elements

    def filter_upstream(
        self,
        elements: List[Dict],
        waterway_geom: List,
        reading_lat: float,
        reading_lon: float,
    ) -> List[Dict]:
        """Keep only OSM features that are upstream of the reading point.

        Uses waterway node ordering (OSM convention: source → mouth).
        A feature is upstream if its closest waterway node index ≤ reading's
        closest node index.
        """
        if not waterway_geom or len(waterway_geom) < 2:
            return elements

        reading_idx = self._closest_node_index(waterway_geom, reading_lat, reading_lon)
        upstream = []

        for el in elements:
            el_lat, el_lon = self._element_center(el)
            if el_lat is None:
                upstream.append(el)
                continue
            el_idx = self._closest_node_index(waterway_geom, el_lat, el_lon)
            if el_idx <= reading_idx:
                upstream.append(el)

        return upstream

    def score_elements(self, elements: List[Dict]) -> tuple:
        """Convert filtered OSM elements to source scores and feature list."""
        found_tags = []
        for el in elements:
            tags = el.get("tags", {})
            for k, v in tags.items():
                found_tags.append(f"{k}={v}")

        scores: Dict[str, float] = {k: 0.0 for k in SOURCE_PROFILES}
        features_found = []

        for key, profile in SOURCE_PROFILES.items():
            for osm_tag in profile["osm_tags"]:
                if osm_tag in found_tags:
                    scores[key] += profile["osm_weight"]
                    features_found.append({"tag": osm_tag, "supports": profile["label"]})

        total = sum(scores.values())
        if total > 0:
            scores = {k: v / total for k, v in scores.items()}
        else:
            scores = {k: 0.0 for k in scores}

        return scores, features_found

    def _osm_scores(self, lat, lon) -> tuple:
        """Legacy sync method — queries and scores in one call (no upstream filter)."""
        elements = self.query_osm_features(lat, lon)
        return self.score_elements(elements)

    @staticmethod
    def _element_center(el: Dict):
        """Extract lat/lon center from an OSM element."""
        if el.get("type") == "node":
            return el.get("lat"), el.get("lon")
        center = el.get("center", {})
        if center:
            return center.get("lat"), center.get("lon")
        bounds = el.get("bounds", {})
        if bounds:
            return (
                (bounds.get("minlat", 0) + bounds.get("maxlat", 0)) / 2,
                (bounds.get("minlon", 0) + bounds.get("maxlon", 0)) / 2,
            )
        return None, None

    @staticmethod
    def _closest_node_index(geom, lat, lon) -> int:
        min_d = float("inf")
        best_idx = 0
        for i, (glat, glon) in enumerate(geom):
            d = (glat - lat) ** 2 + (glon - lon) ** 2
            if d < min_d:
                min_d = d
                best_idx = i
        return best_idx

    @staticmethod
    def _build_evidence(tds, turbidity, ph, source_key) -> List[str]:
        evidence = []
        profile = SOURCE_PROFILES[source_key]

        d_tds = abs(tds - profile["tds_center"]) / profile["tds_std"]
        d_turb = abs(turbidity - profile["turbidity_center"]) / profile["turbidity_std"]
        d_ph = abs(ph - profile["ph_center"]) / profile["ph_std"]

        if d_tds < 1.5:
            evidence.append(f"TDS ({tds:.0f} ppm) within 1.5σ of {profile['label']} profile center ({profile['tds_center']} ppm)")
        if d_turb < 1.5:
            evidence.append(f"Turbidity ({turbidity:.1f} NTU) within 1.5σ of {profile['label']} profile ({profile['turbidity_center']} NTU)")
        if d_ph < 1.5:
            evidence.append(f"pH ({ph:.1f}) within 1.5σ of {profile['label']} profile ({profile['ph_center']})")
        if profile["ph_is_abnormal"] and (ph < 6.5 or ph > 8.5):
            evidence.append(f"Abnormal pH ({ph:.1f}) consistent with {profile['label']} signature")

        if not evidence:
            evidence.append(f"Closest match to {profile['label']} profile by overall parameter distance")

        return evidence
