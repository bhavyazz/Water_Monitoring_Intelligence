"""
pipeline.py — AquaVision Analysis Pipeline Orchestrator

Two modes:
  Batch: Full analysis of all stored samples (hotspots, sources, spread).
  Live:  Single new reading — 8-step async pipeline with parallel OSM calls.

Live pipeline steps:
  1. WQS score against BIS 10500
  2. Early exit if WQS < 0.15 (CLEAN)
  3+4. asyncio.gather: waterway lookup + OSM proximity features (parallel)
  5. Chemical fingerprint (z-score distance)
  6. Combine: 60% chemical + 40% upstream-filtered OSM
  7. ADE spread along waterway geometry
  8. Return combined response
"""

from __future__ import annotations
import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from analysis.wqs_engine import WQSEngine
from analysis.hotspot_engine import HotspotEngine
from analysis.source_engine import SourceIdentifier
from analysis.spread_engine import SpreadEstimator

logger = logging.getLogger(__name__)


def _haversine_m(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 6_371_000 * 2 * math.asin(math.sqrt(a))


class AquaVisionPipeline:

    def __init__(self, skip_osm: bool = False):
        self.wqs = WQSEngine()
        self.hotspot = HotspotEngine(eps_meters=400, min_samples=2)
        self.source = SourceIdentifier()
        self.spread = SpreadEstimator(wqs_engine=self.wqs)
        self.skip_osm = skip_osm

    def run_batch_analysis(self, samples: List[Dict]) -> Dict[str, Any]:
        """
        Mode 1: full analysis of all stored samples.

        Each sample dict needs: lat, lon, tds, turbidity, ph, temperature,
        and optionally id, label, notes, source_type.
        """
        if not samples:
            return {
                "status": "ok",
                "message": "No samples to analyze.",
                "scored_samples": [],
                "hotspots": [],
                "anomalies": [],
                "clean_clusters": [],
                "source_attributions": {},
                "spread_estimates": {},
            }

        scored = []
        for s in samples:
            wqs_result = self.wqs.compute(
                tds=s.get("tds", 0),
                turbidity=s.get("turbidity", 0),
                ph=s.get("ph", 7.0),
                temperature=s.get("temperature", 25.0),
            )
            scored.append({
                **s,
                "wqs": wqs_result["wqs"],
                "classification": wqs_result["classification"],
                "parameter_scores": wqs_result["parameter_scores"],
                "limiting_parameter": wqs_result["limiting_parameter"],
                "exceedances_vs_bis": wqs_result["exceedances_vs_bis"],
                "safe_for_drinking": wqs_result["safe_for_drinking"],
                "safe_for_irrigation": wqs_result["safe_for_irrigation"],
                "safe_for_bathing": wqs_result["safe_for_bathing"],
            })

        hotspot_result = self.hotspot.detect_batch(scored)
        hotspots = hotspot_result["hotspots"]
        anomalies = hotspot_result["anomalies"]
        clean_clusters = hotspot_result["clean_clusters"]

        source_attributions = {}
        spread_estimates = {}

        all_clusters = hotspots + [a for a in anomalies if a.get("classification") == "SEVERE_ANOMALY"]
        for cluster in all_clusters:
            cid = cluster["cluster_id"]
            member_ids = cluster.get("member_ids", [])
            members = [s for s in scored if s.get("id") in member_ids]

            if members:
                avg_tds = sum(m.get("tds", 0) for m in members) / len(members)
                avg_turb = sum(m.get("turbidity", 0) for m in members) / len(members)
                avg_ph = sum(m.get("ph", 7) for m in members) / len(members)
                center = cluster["center"]

                src = self.source.identify(
                    tds=avg_tds,
                    turbidity=avg_turb,
                    ph=avg_ph,
                    lat=center[0] if isinstance(center, list) else center[0],
                    lon=center[1] if isinstance(center, list) else center[1],
                    skip_osm=self.skip_osm,
                )
                source_attributions[cid] = src

            if cluster.get("classification") == "CONFIRMED_HOTSPOT":
                center = cluster["center"]
                mean_wqs = cluster.get("mean_wqs", 0)
                if mean_wqs > 0.15:
                    try:
                        wb = self.spread.find_water_body(
                            center[0] if isinstance(center, list) else center[0],
                            center[1] if isinstance(center, list) else center[1],
                        ) if not self.skip_osm else None
                    except Exception:
                        wb = None

                    spread_result = self.spread.estimate_spread(
                        wqs=mean_wqs,
                        lat=center[0] if isinstance(center, list) else center[0],
                        lon=center[1] if isinstance(center, list) else center[1],
                        water_body=wb,
                    )
                    spread_estimates[cid] = spread_result

        for a in anomalies:
            if a.get("classification") == "SEVERE_ANOMALY":
                cid = a["cluster_id"]
                if cid not in source_attributions:
                    member_ids = a.get("member_ids", [])
                    members = [s for s in scored if s.get("id") in member_ids]
                    if members:
                        m = members[0]
                        src = self.source.identify(
                            tds=m.get("tds", 0),
                            turbidity=m.get("turbidity", 0),
                            ph=m.get("ph", 7),
                            lat=m.get("lat"),
                            lon=m.get("lon"),
                            skip_osm=self.skip_osm,
                        )
                        source_attributions[cid] = src

        summary = {
            "total_samples": len(scored),
            "clean": sum(1 for s in scored if s["classification"] == "CLEAN"),
            "moderate": sum(1 for s in scored if s["classification"] == "MODERATE"),
            "polluted": sum(1 for s in scored if s["classification"] == "POLLUTED"),
            "severely_polluted": sum(1 for s in scored if s["classification"] == "SEVERELY_POLLUTED"),
            "confirmed_hotspots": len(hotspots),
            "anomalies": len(anomalies),
            "clean_clusters": len(clean_clusters),
        }

        return {
            "status": "ok",
            "summary": summary,
            "scored_samples": scored,
            "hotspots": hotspots,
            "anomalies": anomalies,
            "clean_clusters": clean_clusters,
            "source_attributions": source_attributions,
            "spread_estimates": spread_estimates,
            "hotspot_methodology": hotspot_result.get("methodology_note", ""),
        }

    def run_live_analysis(
        self,
        live_reading: Dict,
        stored_samples: List[Dict],
        water_body_override: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Mode 2: analyze single new reading at any location worldwide.
        """
        wqs_result = self.wqs.compute(
            tds=live_reading.get("tds", 0),
            turbidity=live_reading.get("turbidity", 0),
            ph=live_reading.get("ph", 7.0),
            temperature=live_reading.get("temperature", 25.0),
        )

        scored_live = {
            **live_reading,
            "wqs": wqs_result["wqs"],
            "classification": wqs_result["classification"],
            "parameter_scores": wqs_result["parameter_scores"],
        }

        if wqs_result["wqs"] < 0.15:
            action = "SAFE TO USE"
            action_detail = "All measured parameters within BIS 10500 acceptable limits."
        elif wqs_result["wqs"] < 0.40:
            action = "USE WITH CAUTION"
            action_detail = (
                f"Elevated {wqs_result['limiting_parameter']}. "
                "Safe for irrigation; test before drinking."
            )
        elif wqs_result["wqs"] < 0.65:
            action = "DO NOT USE"
            action_detail = (
                f"Polluted — {wqs_result['limiting_parameter']} significantly exceeds BIS limits. "
                "Not safe for drinking or bathing."
            )
        else:
            action = "DO NOT USE — SEVERE CONTAMINATION"
            action_detail = (
                f"Severely polluted — multiple parameters exceed permissible limits. "
                "Avoid all contact."
            )

        scored_stored = []
        for s in stored_samples:
            sw = self.wqs.compute(
                tds=s.get("tds", 0),
                turbidity=s.get("turbidity", 0),
                ph=s.get("ph", 7.0),
                temperature=s.get("temperature", 25.0),
            )
            scored_stored.append({**s, "wqs": sw["wqs"]})

        hotspot_cls = self.hotspot.classify_live_reading(scored_live, scored_stored)

        source_result = self.source.identify(
            tds=live_reading.get("tds", 0),
            turbidity=live_reading.get("turbidity", 0),
            ph=live_reading.get("ph", 7.0),
            lat=live_reading.get("lat"),
            lon=live_reading.get("lon"),
            skip_osm=self.skip_osm,
        )

        spread_result = None
        if wqs_result["wqs"] >= 0.15 and live_reading.get("lat") and live_reading.get("lon"):
            try:
                wb = None
                if not self.skip_osm:
                    wb = self.spread.find_water_body(
                        live_reading["lat"], live_reading["lon"]
                    )
            except Exception:
                wb = None

            spread_result = self.spread.estimate_spread(
                wqs=wqs_result["wqs"],
                lat=live_reading["lat"],
                lon=live_reading["lon"],
                water_body=wb,
                water_body_override=water_body_override,
            )

        return {
            "status": "ok",
            "wqs": wqs_result,
            "hotspot_status": hotspot_cls.to_dict(),
            "source": source_result,
            "spread": spread_result,
            "verdict": {
                "action": action,
                "detail": action_detail,
                "classification": wqs_result["classification"],
            },
        }

    async def run_live_async(
        self,
        live_reading: Dict,
        stored_samples: List[Dict],
        water_body_override: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """8-step async pipeline for a single Arduino reading."""
        lat = live_reading.get("lat")
        lon = live_reading.get("lon")
        tds = live_reading.get("tds", 0)
        turbidity = live_reading.get("turbidity", 0)
        ph = live_reading.get("ph", 7.0)
        temperature = live_reading.get("temperature", 25.0)

        # ── Step 1: WQS ──
        wqs_result = self.wqs.compute(
            tds=tds, turbidity=turbidity, ph=ph, temperature=temperature,
        )
        wqs_score = wqs_result["wqs"]

        # ── Step 2: Early exit if clean ──
        if wqs_score < 0.15:
            return {
                "status": "ok",
                "wqs": wqs_result,
                "water_body": None,
                "source": None,
                "spread": None,
                "hotspot_status": None,
                "verdict": {
                    "action": "SAFE TO USE",
                    "detail": "All measured parameters within BIS 10500 acceptable limits.",
                    "classification": wqs_result["classification"],
                },
                "coordinates_analyzed": {"lat": lat, "lon": lon},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        # ── Steps 3+4: Parallel OSM calls ──
        water_body = None
        osm_elements = []
        has_coords = lat is not None and lon is not None

        if has_coords and not self.skip_osm:
            # NOTE: Overpass rate-limits concurrent requests from one IP — firing
            # both queries at once (asyncio.gather) gets one 429'd, so the river
            # lookup silently fails. Run them sequentially off-thread instead.
            try:
                water_body = await asyncio.to_thread(self.spread.find_water_body, lat, lon)
            except Exception as e:
                logger.warning("Water body lookup failed: %s", e)
            try:
                osm_elements = await asyncio.to_thread(self.source.query_osm_features, lat, lon)
            except Exception as e:
                logger.warning("OSM feature query failed: %s", e)

        # ── Step 5: Chemical fingerprint ──
        # (computed inside identify() but we prepare upstream-filtered OSM data first)

        # ── Step 6: Combine with upstream filtering ──
        precomputed_osm = None
        if osm_elements and water_body and water_body.get("geometry"):
            upstream_els = self.source.filter_upstream(
                osm_elements, water_body["geometry"], lat, lon,
            )
            scores, features = self.source.score_elements(upstream_els)
            precomputed_osm = {
                "scores": scores,
                "features": features,
                "upstream_filtered": True,
            }
        elif osm_elements:
            scores, features = self.source.score_elements(osm_elements)
            precomputed_osm = {
                "scores": scores,
                "features": features,
                "upstream_filtered": False,
            }

        source_result = self.source.identify(
            tds=tds, turbidity=turbidity, ph=ph,
            lat=lat, lon=lon,
            skip_osm=True,
            precomputed_osm=precomputed_osm,
        )

        # ── Step 7: ADE spread along waterway geometry ──
        spread_result = None
        if wqs_score >= 0.15 and has_coords:
            spread_result = self.spread.estimate_spread(
                wqs=wqs_score,
                lat=lat, lon=lon,
                water_body=water_body,
                water_body_override=water_body_override,
            )

        # ── Hotspot check against stored samples ──
        scored_stored = []
        for s in stored_samples:
            sw = self.wqs.compute(
                tds=s.get("tds", 0), turbidity=s.get("turbidity", 0),
                ph=s.get("ph", 7.0), temperature=s.get("temperature", 25.0),
            )
            scored_stored.append({**s, "wqs": sw["wqs"]})

        scored_live = {
            **live_reading,
            "wqs": wqs_score,
            "classification": wqs_result["classification"],
            "parameter_scores": wqs_result["parameter_scores"],
        }
        hotspot_cls = self.hotspot.classify_live_reading(scored_live, scored_stored)

        # ── Verdict ──
        if wqs_score < 0.40:
            action = "USE WITH CAUTION"
            action_detail = (
                f"Elevated {wqs_result['limiting_parameter']}. "
                "Safe for irrigation; test before drinking."
            )
        elif wqs_score < 0.65:
            action = "DO NOT USE"
            action_detail = (
                f"Polluted — {wqs_result['limiting_parameter']} significantly exceeds BIS limits. "
                "Not safe for drinking or bathing."
            )
        else:
            action = "DO NOT USE — SEVERE CONTAMINATION"
            action_detail = (
                "Severely polluted — multiple parameters exceed permissible limits. "
                "Avoid all contact."
            )

        # ── Step 8: Combined response ──
        return {
            "status": "ok",
            "wqs": wqs_result,
            "hotspot_status": hotspot_cls.to_dict(),
            "water_body": {
                "name": water_body.get("name", "unknown") if water_body else None,
                "type": water_body.get("type", "not_found") if water_body else "not_found",
                "distance_m": water_body.get("distance_m") if water_body else None,
            } if water_body else None,
            "source": source_result,
            "spread": spread_result,
            "verdict": {
                "action": action,
                "detail": action_detail,
                "classification": wqs_result["classification"],
            },
            "coordinates_analyzed": {"lat": lat, "lon": lon},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def run_live_streaming(
        self,
        live_reading: Dict,
        stored_samples: List[Dict],
        water_body_override: Optional[Dict] = None,
    ):
        """Async generator yielding SSE step results as they complete."""
        lat = live_reading.get("lat")
        lon = live_reading.get("lon")
        tds = live_reading.get("tds", 0)
        turbidity = live_reading.get("turbidity", 0)
        ph = live_reading.get("ph", 7.0)
        temperature = live_reading.get("temperature", 25.0)
        has_coords = lat is not None and lon is not None

        wqs_result = self.wqs.compute(
            tds=tds, turbidity=turbidity, ph=ph, temperature=temperature,
        )
        wqs_score = wqs_result["wqs"]
        yield {"step": "wqs", "data": wqs_result}

        if wqs_score < 0.15:
            yield {"step": "clean_exit", "data": {
                "action": "SAFE TO USE",
                "detail": "All measured parameters within BIS 10500 acceptable limits.",
                "classification": wqs_result["classification"],
            }}
            return

        yield {"step": "searching", "data": {"lat": lat, "lon": lon}}

        water_body = None
        osm_elements = []

        if has_coords and not self.skip_osm:
            # NOTE: Overpass rate-limits concurrent requests from one IP — firing
            # both queries at once (asyncio.gather) gets one 429'd, so the river
            # lookup silently fails. Run them sequentially off-thread instead.
            try:
                water_body = await asyncio.to_thread(self.spread.find_water_body, lat, lon)
            except Exception as e:
                logger.warning("Water body lookup failed: %s", e)
            try:
                osm_elements = await asyncio.to_thread(self.source.query_osm_features, lat, lon)
            except Exception as e:
                logger.warning("OSM feature query failed: %s", e)

        wb_data = None
        if water_body:
            geom = water_body.get("geometry", [])
            wb_data = {
                "type": water_body.get("type", "not_found"),
                "name": water_body.get("name", "unknown"),
                "waterway_type": water_body.get("waterway_type"),
                "distance_m": water_body.get("distance_m"),
                "geometry": [[g[0], g[1]] for g in geom[:150]],
            }
        else:
            wb_data = {"type": "not_found", "user_input_required": True}
        yield {"step": "water_body", "data": wb_data}

        features_list = []
        precomputed_osm = None
        if osm_elements:
            upstream_set = set()
            if water_body and water_body.get("geometry"):
                upstream_els = self.source.filter_upstream(
                    osm_elements, water_body["geometry"], lat, lon,
                )
                upstream_set = {id(el) for el in upstream_els}
                scores, features = self.source.score_elements(upstream_els)
                precomputed_osm = {
                    "scores": scores, "features": features,
                    "upstream_filtered": True,
                }
            else:
                scores, features = self.source.score_elements(osm_elements)
                precomputed_osm = {
                    "scores": scores, "features": features,
                    "upstream_filtered": False,
                }

            for el in osm_elements[:20]:
                tags = el.get("tags", {})
                el_lat, el_lon = self.source._element_center(el)
                dist = None
                if el_lat is not None and has_coords:
                    try:
                        dist = round(_haversine_m(lat, lon, el_lat, el_lon))
                    except Exception:
                        pass
                relevant = [f"{k}={v}" for k, v in tags.items()
                            if k in ("landuse", "man_made", "amenity", "waterway")]
                if relevant:
                    is_upstream = id(el) in upstream_set if upstream_set else None
                    features_list.append({
                        "tag": relevant[0],
                        "distance_m": dist,
                        "upstream": is_upstream,
                    })

        yield {"step": "features", "data": features_list}

        source_result = self.source.identify(
            tds=tds, turbidity=turbidity, ph=ph,
            lat=lat, lon=lon, skip_osm=True,
            precomputed_osm=precomputed_osm,
        )
        yield {"step": "source", "data": source_result}

        spread_result = None
        spread_error = False
        if wqs_score >= 0.15 and has_coords:
            try:
                spread_result = self.spread.estimate_spread(
                    wqs=wqs_score, lat=lat, lon=lon,
                    water_body=water_body,
                    water_body_override=water_body_override,
                )
            except Exception as e:
                yield {"step": "spread", "error": str(e)}
                spread_error = True
        if not spread_error:
            yield {"step": "spread", "data": spread_result}

        scored_stored = []
        for s in stored_samples:
            sw = self.wqs.compute(
                tds=s.get("tds", 0), turbidity=s.get("turbidity", 0),
                ph=s.get("ph", 7.0), temperature=s.get("temperature", 25.0),
            )
            scored_stored.append({**s, "wqs": sw["wqs"]})

        scored_live = {
            **live_reading,
            "wqs": wqs_score,
            "classification": wqs_result["classification"],
            "parameter_scores": wqs_result["parameter_scores"],
        }
        hotspot_cls = self.hotspot.classify_live_reading(scored_live, scored_stored)
        yield {"step": "hotspot", "data": hotspot_cls.to_dict()}

        if wqs_score < 0.40:
            action = "USE WITH CAUTION"
            action_detail = (
                f"Elevated {wqs_result['limiting_parameter']}. "
                "Safe for irrigation; test before drinking."
            )
        elif wqs_score < 0.65:
            action = "DO NOT USE"
            action_detail = (
                f"Polluted — {wqs_result['limiting_parameter']} significantly "
                "exceeds BIS limits. Not safe for drinking or bathing."
            )
        else:
            action = "DO NOT USE — SEVERE CONTAMINATION"
            action_detail = (
                "Severely polluted — multiple parameters exceed permissible "
                "limits. Avoid all contact."
            )

        yield {"step": "verdict", "data": {
            "action": action,
            "detail": action_detail,
            "classification": wqs_result["classification"],
        }}
