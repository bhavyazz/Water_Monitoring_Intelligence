"""
hotspot_engine.py — Spatiotemporal Hotspot Detection

Distinguishes genuine contamination zones from isolated anomalies
using spatial co-occurrence of elevated WQS readings. A single bad
reading could be sensor noise or a transient event; spatial clustering
of multiple bad readings confirms a persistent hotspot.

Batch mode: DBSCAN over all stored samples.
Live mode: classify a new reading against nearby historical data.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.cluster import DBSCAN


@dataclass
class HotspotCluster:
    cluster_id: int
    classification: str
    reasoning: str
    center: Tuple[float, float]
    member_ids: List[str] = field(default_factory=list)
    mean_wqs: float = 0.0
    max_wqs: float = 0.0
    spatial_extent_m: float = 0.0
    severity: str = "LOW"
    dominant_parameter: str = "none"
    member_count: int = 0

    def to_dict(self) -> dict:
        return {
            "cluster_id": self.cluster_id,
            "classification": self.classification,
            "reasoning": self.reasoning,
            "center": list(self.center),
            "member_ids": self.member_ids,
            "mean_wqs": round(self.mean_wqs, 4),
            "max_wqs": round(self.max_wqs, 4),
            "spatial_extent_m": round(self.spatial_extent_m, 1),
            "severity": self.severity,
            "dominant_parameter": self.dominant_parameter,
            "member_count": self.member_count,
        }


@dataclass
class LiveClassification:
    status: str
    reasoning: str
    wqs: float = 0.0
    classification: str = ""
    nearby_count: int = 0
    nearby_polluted: int = 0

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "reasoning": self.reasoning,
            "wqs": round(self.wqs, 4),
            "classification": self.classification,
            "nearby_count": self.nearby_count,
            "nearby_polluted": self.nearby_polluted,
        }


EARTH_R = 6_371_000


def _haversine_m(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return EARTH_R * 2 * math.asin(math.sqrt(a))


class HotspotEngine:

    def __init__(self, eps_meters: float = 400.0, min_samples: int = 2):
        self.eps_rad = eps_meters / EARTH_R
        self.eps_meters = eps_meters
        self.min_samples = min_samples

    def detect_batch(self, scored_samples: List[Dict]) -> Dict:
        """
        Run hotspot detection on all scored samples.

        Each sample dict must have: lat, lon, wqs, classification,
        parameter_scores, id, label.

        Returns dict with hotspots, anomalies, clean_clusters.
        """
        valid = [s for s in scored_samples
                 if s.get("lat") is not None and s.get("lon") is not None]
        if len(valid) < self.min_samples:
            return {"hotspots": [], "anomalies": [], "clean_clusters": []}

        coords = np.array([
            [math.radians(s["lat"]), math.radians(s["lon"])]
            for s in valid
        ])

        db = DBSCAN(eps=self.eps_rad, min_samples=self.min_samples, metric="haversine")
        labels = db.fit_predict(coords)

        clusters: Dict[int, List[Dict]] = {}
        noise_samples: List[Dict] = []

        for i, label in enumerate(labels):
            if label == -1:
                noise_samples.append(valid[i])
            else:
                clusters.setdefault(label, []).append(valid[i])

        hotspots = []
        clean_clusters = []
        anomalies = []
        cluster_id = 0

        for cid in sorted(clusters.keys()):
            members = clusters[cid]
            wqs_vals = [m["wqs"] for m in members]
            mean_wqs = float(np.mean(wqs_vals))
            max_wqs = float(np.max(wqs_vals))

            mean_lat = float(np.mean([m["lat"] for m in members]))
            mean_lon = float(np.mean([m["lon"] for m in members]))

            extent = max(
                _haversine_m(mean_lat, mean_lon, m["lat"], m["lon"])
                for m in members
            ) if len(members) > 1 else 0.0

            param_avgs = {}
            for p in ["tds", "turbidity", "ph", "temperature"]:
                vals = [m.get("parameter_scores", {}).get(p, 0) for m in members]
                param_avgs[p] = float(np.mean(vals)) if vals else 0.0
            dominant = max(param_avgs, key=param_avgs.get) if param_avgs else "none"

            severity = "HIGH" if mean_wqs > 0.40 else "MODERATE" if mean_wqs > 0.15 else "LOW"

            if mean_wqs <= 0.10:
                hc = HotspotCluster(
                    cluster_id=cluster_id,
                    classification="CLEAN_CLUSTER",
                    reasoning=(
                        f"Cluster of {len(members)} clean readings. "
                        "Cold spot — confirms baseline water quality."
                    ),
                    center=(mean_lat, mean_lon),
                    member_ids=[m.get("id", "") for m in members],
                    mean_wqs=mean_wqs,
                    max_wqs=max_wqs,
                    spatial_extent_m=extent,
                    severity="LOW",
                    dominant_parameter=dominant,
                    member_count=len(members),
                )
                clean_clusters.append(hc.to_dict())
            elif len(members) >= 2 and mean_wqs > 0.25:
                hc = HotspotCluster(
                    cluster_id=cluster_id,
                    classification="CONFIRMED_HOTSPOT",
                    reasoning=(
                        f"Multiple spatially co-located readings (n={len(members)}) "
                        f"confirm persistent contamination zone. Mean WQS={mean_wqs:.3f}, "
                        f"driven by {dominant}."
                    ),
                    center=(mean_lat, mean_lon),
                    member_ids=[m.get("id", "") for m in members],
                    mean_wqs=mean_wqs,
                    max_wqs=max_wqs,
                    spatial_extent_m=extent,
                    severity=severity,
                    dominant_parameter=dominant,
                    member_count=len(members),
                )
                hotspots.append(hc.to_dict())
            else:
                hc = HotspotCluster(
                    cluster_id=cluster_id,
                    classification="ELEVATED_CLUSTER",
                    reasoning=(
                        f"Cluster of {len(members)} readings with mean WQS={mean_wqs:.3f}. "
                        f"Elevated but below confirmed hotspot threshold (0.40)."
                    ),
                    center=(mean_lat, mean_lon),
                    member_ids=[m.get("id", "") for m in members],
                    mean_wqs=mean_wqs,
                    max_wqs=max_wqs,
                    spatial_extent_m=extent,
                    severity=severity,
                    dominant_parameter=dominant,
                    member_count=len(members),
                )
                anomalies.append(hc.to_dict())

            cluster_id += 1

        for ns in noise_samples:
            wqs = ns.get("wqs", 0)
            if wqs > 0.40:
                anomalies.append({
                    "cluster_id": cluster_id,
                    "classification": "SEVERE_ANOMALY",
                    "reasoning": (
                        "Single severely polluted reading with no nearby corroboration. "
                        "May indicate localized point discharge or sensor artifact. "
                        "Requires additional readings within 400m to confirm."
                    ),
                    "center": [ns["lat"], ns["lon"]],
                    "member_ids": [ns.get("id", "")],
                    "mean_wqs": round(wqs, 4),
                    "max_wqs": round(wqs, 4),
                    "spatial_extent_m": 0.0,
                    "severity": "HIGH",
                    "dominant_parameter": max(
                        ns.get("parameter_scores", {}).items(),
                        key=lambda x: x[1],
                        default=("none", 0),
                    )[0],
                    "member_count": 1,
                })
                cluster_id += 1
            elif wqs > 0.20:
                anomalies.append({
                    "cluster_id": cluster_id,
                    "classification": "MODERATE_ANOMALY",
                    "reasoning": (
                        "Single moderately polluted reading. Insufficient spatial "
                        "evidence for hotspot classification."
                    ),
                    "center": [ns["lat"], ns["lon"]],
                    "member_ids": [ns.get("id", "")],
                    "mean_wqs": round(wqs, 4),
                    "max_wqs": round(wqs, 4),
                    "spatial_extent_m": 0.0,
                    "severity": "MODERATE",
                    "dominant_parameter": max(
                        ns.get("parameter_scores", {}).items(),
                        key=lambda x: x[1],
                        default=("none", 0),
                    )[0],
                    "member_count": 1,
                })
                cluster_id += 1

        return {
            "hotspots": hotspots,
            "anomalies": anomalies,
            "clean_clusters": clean_clusters,
            "methodology_note": (
                f"DBSCAN spatial clustering (eps={self.eps_meters}m, min_samples={self.min_samples}, "
                "metric=haversine). Classification based on mean WQS within each cluster. "
                "CONFIRMED_HOTSPOT requires cluster_size>=2 AND mean_wqs>0.25. "
                "Isolated readings classified as ANOMALY, not hotspot."
            ),
        }

    def classify_live_reading(
        self,
        live: Dict,
        stored_samples: List[Dict],
        radius_m: float = 500.0,
    ) -> LiveClassification:
        """
        Classify a single live reading against nearby historical data.
        """
        wqs = live.get("wqs", 0)
        lat = live.get("lat")
        lon = live.get("lon")

        if wqs < 0.15:
            return LiveClassification(
                status="CLEAN",
                reasoning="Reading within safe limits for all parameters.",
                wqs=wqs,
                classification="CLEAN",
            )

        if lat is None or lon is None:
            return LiveClassification(
                status="NO_GPS",
                reasoning="No GPS coordinates — cannot perform spatial analysis.",
                wqs=wqs,
                classification=self._wqs_class(wqs),
            )

        nearby = [
            s for s in stored_samples
            if s.get("lat") is not None and s.get("lon") is not None
            and _haversine_m(lat, lon, s["lat"], s["lon"]) <= radius_m
        ]

        if len(nearby) == 0:
            return LiveClassification(
                status="ISOLATED_READING",
                reasoning=(
                    f"No historical readings within {radius_m:.0f}m for spatial context. "
                    "Cannot determine hotspot status from single reading. "
                    f"Collect 2+ additional readings within {self.eps_meters:.0f}m to confirm."
                ),
                wqs=wqs,
                classification=self._wqs_class(wqs),
                nearby_count=0,
            )

        nearby_polluted = [s for s in nearby if s.get("wqs", 0) > 0.25]

        if len(nearby_polluted) >= 1 and wqs > 0.25:
            return LiveClassification(
                status="CONTEXTUAL_HOTSPOT",
                reasoning=(
                    f"Live reading extends known contamination zone. "
                    f"{len(nearby_polluted)} nearby historical reading(s) also show "
                    f"elevated WQS. Spatial cluster confirms persistent hotspot."
                ),
                wqs=wqs,
                classification="CONFIRMED_HOTSPOT",
                nearby_count=len(nearby),
                nearby_polluted=len(nearby_polluted),
            )

        if all(s.get("wqs", 0) < 0.20 for s in nearby):
            return LiveClassification(
                status="NEW_ANOMALY",
                reasoning=(
                    "Elevated reading at location where historical data shows clean water. "
                    "Possible new contamination event or transient discharge."
                ),
                wqs=wqs,
                classification="NEW_ANOMALY",
                nearby_count=len(nearby),
                nearby_polluted=0,
            )

        return LiveClassification(
            status="MIXED_CONTEXT",
            reasoning=(
                f"Reading in area with mixed historical quality ({len(nearby)} nearby, "
                f"{len(nearby_polluted)} polluted). Monitor for trend confirmation."
            ),
            wqs=wqs,
            classification=self._wqs_class(wqs),
            nearby_count=len(nearby),
            nearby_polluted=len(nearby_polluted),
        )

    @staticmethod
    def _wqs_class(wqs):
        if wqs < 0.15:
            return "CLEAN"
        if wqs < 0.40:
            return "MODERATE"
        if wqs < 0.65:
            return "POLLUTED"
        return "SEVERELY_POLLUTED"
