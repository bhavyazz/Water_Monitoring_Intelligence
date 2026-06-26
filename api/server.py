"""
server.py -- FastAPI Backend API

Core endpoints (live pipeline):
  GET  /data        -> latest processed reading
  GET  /history     -> last N readings
  GET  /clusters    -> pollution hotspot clusters
  GET  /alerts      -> water quality + bloom alerts

Field assessment endpoints (any location):
  POST /samples          -> add a new geotagged water sample
  GET  /samples          -> get all stored samples with scores
  POST /water-bodies     -> add a water body to the network
  POST /water-bodies/connect -> connect two water bodies
  GET  /water-bodies     -> get water body network
  GET  /analysis         -> full analysis (clusters, sources, spread)
  POST /analysis/maps    -> regenerate maps
"""

from __future__ import annotations
import asyncio
import json
import os
import math
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from pydantic import BaseModel, Field
import numpy as np


# ── Request/Response models ──────────────────────────────────────────

class SampleInput(BaseModel):
    latitude: float = Field(..., description="GPS latitude (decimal degrees)")
    longitude: float = Field(..., description="GPS longitude (decimal degrees)")
    tds: float = Field(..., description="Total Dissolved Solids (ppm)")
    turbidity: float = Field(..., description="Turbidity (NTU)")
    ph: float = Field(..., description="pH value (0-14)")
    temperature: float = Field(..., description="Water temperature (Celsius)")
    location_name: str = Field("", description="Name of sampling location")
    water_body_id: str = Field("", description="ID of associated water body (optional)")
    rgb: Optional[List[int]] = Field(None, description="RGB color reading [R, G, B]")
    notes: str = Field("", description="Field observations")
    sample_id: Optional[str] = Field(None, description="Custom sample ID (auto-generated if omitted)")


class WaterBodyInput(BaseModel):
    body_id: str = Field(..., description="Unique identifier (e.g. 'lake_mysuru')")
    name: str = Field(..., description="Display name")
    body_type: str = Field(..., description="Type: river, lake, pond, drain, channel, stream")
    latitude: float
    longitude: float
    description: str = ""


class ConnectionInput(BaseModel):
    body_a: str = Field(..., description="First water body ID")
    body_b: str = Field(..., description="Second water body ID")
    distance_km: float = Field(..., description="Distance between them in km")


class LiveAnalysisInput(BaseModel):
    tds: float
    turbidity: float
    ph: float
    temperature: float
    lat: Optional[float] = None
    lon: Optional[float] = None
    water_body_type: Optional[str] = None
    flow_velocity_ms: Optional[float] = None


class HistoricalSampleInput(BaseModel):
    sample_id: Optional[str] = None
    lat: float
    lon: float
    tds: float
    turbidity: float
    ph: float


def create_app(storage, detector, source_id, spread_analyzer_cls, geojson_builder,
               sample_store=None, wb_store=None, contamination_scorer=None,
               early_warning_holder=None) -> FastAPI:
    """
    Factory that creates the FastAPI application.

    Args:
        storage:               StorageEngine (live pipeline readings).
        detector:              HotspotDetector instance.
        source_id:             SourceIdentifier instance.
        spread_analyzer_cls:   SpreadAnalyzer class.
        geojson_builder:       GeoJSONBuilder class.
        sample_store:          SampleStore (persistent field samples).
        wb_store:              WaterBodyStore (persistent water body network).
        contamination_scorer:  ContaminationScorer instance.
    """
    app = FastAPI(
        title="Water Quality Monitoring API",
        description=(
            "AI + IoT backend for water quality monitoring, pollution analysis, "
            "and field assessment. Works with any water body at any location."
        ),
        version="2.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ══════════════════════════════════════════════════════════════
    # LIVE PIPELINE ENDPOINTS (existing)
    # ══════════════════════════════════════════════════════════════

    @app.get("/data", summary="Latest processed reading")
    def get_latest_data() -> Dict[str, Any]:
        reading = storage.latest()
        if reading is None:
            return {"status": "no_data", "reading": None}
        return {"status": "ok", "reading": reading.to_dict()}

    @app.get("/history", summary="Last N readings")
    def get_history(n: int = Query(default=50, ge=1, le=500)) -> Dict[str, Any]:
        readings = storage.last_n(n)
        return {
            "status": "ok",
            "count": len(readings),
            "readings": [r.to_dict() for r in readings],
        }

    @app.get("/clusters", summary="Pollution hotspot clusters")
    def get_clusters() -> Dict[str, Any]:
        all_readings = storage.all()
        clusters = detector.detect(all_readings)

        for c in clusters:
            avg_tds = _safe_mean([r.tds for r in c.readings if r.tds is not None])
            avg_turb = _safe_mean([r.turbidity for r in c.readings if r.turbidity is not None])
            avg_ph = _safe_mean([r.ph for r in c.readings if r.ph is not None], default=7.0)
            avg_temp = _safe_mean([r.temperature for r in c.readings if r.temperature is not None], default=25.0)

            c.probable_source = source_id.identify(avg_tds, avg_turb, avg_ph, avg_temp)
            direction, speed = spread_analyzer_cls.analyze(c.readings)
            c.spread_direction = direction
            c.spread_speed = speed

        geojson = geojson_builder.build(clusters)
        return {
            "status": "ok",
            "cluster_count": len(clusters),
            "clusters": [c.to_dict() for c in clusters],
            "geojson": geojson,
        }

    @app.get("/alerts", summary="Water quality and bloom alerts")
    def get_alerts() -> Dict[str, Any]:
        recent = storage.last_n(20)
        alerts: List[Dict[str, Any]] = []

        for r in recent:
            entry_alerts = []
            if r.quality_label == "Unsafe":
                entry_alerts.append({
                    "type": "water_quality", "level": "CRITICAL",
                    "message": f"Unsafe water -- WQI={r.contamination_score or 0:.0f}, TDS={r.tds}, Turb={r.turbidity}",
                })
            elif r.quality_label == "Moderate":
                entry_alerts.append({
                    "type": "water_quality", "level": "WARNING",
                    "message": f"Moderate degradation -- WQI={r.contamination_score or 0:.0f}, TDS={r.tds}, Turb={r.turbidity}",
                })
            if r.bloom_risk == "HIGH":
                entry_alerts.append({
                    "type": "algal_bloom", "level": "CRITICAL",
                    "message": f"High bloom risk -- pH={r.ph}, Temp={r.temperature}",
                })
            elif r.bloom_risk == "MODERATE":
                entry_alerts.append({
                    "type": "algal_bloom", "level": "WARNING",
                    "message": f"Moderate bloom risk -- pH={r.ph}, Temp={r.temperature}",
                })
            if entry_alerts:
                alerts.append({
                    "timestamp": r.timestamp.isoformat(),
                    "location": [r.latitude, r.longitude],
                    "alerts": entry_alerts,
                })

        return {"status": "ok", "alert_count": len(alerts), "alerts": alerts}

    # ══════════════════════════════════════════════════════════════
    # FIELD ASSESSMENT ENDPOINTS (new -- works for any location)
    # ══════════════════════════════════════════════════════════════

    @app.post("/samples", summary="Add a new geotagged water sample")
    def add_sample(sample: SampleInput) -> Dict[str, Any]:
        """
        Add a field-collected water sample. Auto-computes:
        - Contamination score (WQI)
        - Quality label (Safe/Moderate/Unsafe)
        - Pollution source attribution
        - Whether it joins an existing hotspot or forms a new one
        """
        if sample_store is None or contamination_scorer is None:
            return {"status": "error", "message": "Assessment mode not enabled. Start with --preload or --assessment."}

        # Score the sample
        result = contamination_scorer.compute(
            ph=sample.ph, tds=sample.tds,
            turbidity=sample.turbidity, temperature=sample.temperature,
        )

        # Source attribution
        source_result = source_id.identify_with_details(
            sample.tds, sample.turbidity, sample.ph, sample.temperature,
        )

        # Build record
        record = {
            **({"sample_id": sample.sample_id} if sample.sample_id else {}),
            "latitude": sample.latitude,
            "longitude": sample.longitude,
            "tds": sample.tds,
            "turbidity": sample.turbidity,
            "ph": sample.ph,
            "temperature": sample.temperature,
            "location_name": sample.location_name,
            "water_body_id": sample.water_body_id,
            "rgb": sample.rgb,
            "notes": sample.notes,
            "contamination_score": result["score"],
            "quality_label": result["quality_label"],
            "wqi_label": result["label"],
            "sub_indices": result["sub_indices"],
            "pollution_source": source_result["source"],
            "source_confidence": source_result["confidence"],
            "source_reasons": source_result["reasons"],
        }

        saved = sample_store.add(record)

        # Re-run clustering to check if this sample joins/creates a hotspot
        cluster_info = _check_cluster_membership(saved, detector, source_id, contamination_scorer)

        return {
            "status": "ok",
            "sample": saved,
            "analysis": {
                "contamination_score": result["score"],
                "quality_label": result["quality_label"],
                "wqi_label": result["label"],
                "sub_indices": result["sub_indices"],
                "pollution_source": source_result["source"],
                "source_confidence": source_result["confidence"],
                "source_reasons": source_result["reasons"],
            },
            "cluster": cluster_info,
        }

    @app.get("/samples", summary="Get all stored samples with scores")
    def get_samples() -> Dict[str, Any]:
        if sample_store is None:
            return {"status": "error", "message": "Assessment mode not enabled."}
        samples = sample_store.all()
        return {"status": "ok", "count": len(samples), "samples": samples}

    @app.post("/water-bodies", summary="Add a water body to the network")
    def add_water_body(body: WaterBodyInput) -> Dict[str, Any]:
        if wb_store is None:
            return {"status": "error", "message": "Assessment mode not enabled."}
        result = wb_store.add_body(
            body.body_id, body.name, body.body_type,
            body.latitude, body.longitude, body.description,
        )
        return {"status": "ok", "water_body": result}

    @app.post("/water-bodies/connect", summary="Connect two water bodies")
    def connect_water_bodies(conn: ConnectionInput) -> Dict[str, Any]:
        if wb_store is None:
            return {"status": "error", "message": "Assessment mode not enabled."}
        try:
            wb_store.connect(conn.body_a, conn.body_b, conn.distance_km)
            return {"status": "ok", "message": f"Connected {conn.body_a} <-> {conn.body_b} ({conn.distance_km} km)"}
        except ValueError as e:
            return {"status": "error", "message": str(e)}

    @app.get("/water-bodies", summary="Get water body network")
    def get_water_bodies() -> Dict[str, Any]:
        if wb_store is None:
            return {"status": "error", "message": "Assessment mode not enabled."}
        bodies = wb_store.get_bodies()
        connections = wb_store.get_connections()
        return {
            "status": "ok",
            "body_count": len(bodies),
            "bodies": bodies,
            "connections": {k: [{"id": c[0], "distance_km": c[1]} for c in v] for k, v in connections.items()},
        }

    @app.get("/analysis", summary="Full analysis on all stored samples")
    def run_analysis() -> Dict[str, Any]:
        """
        Runs complete pipeline on all stored samples:
        1. Contamination scoring (WQI)
        2. DBSCAN hotspot clustering
        3. Source attribution per cluster
        4. Spread analysis through water body network
        """
        if sample_store is None or contamination_scorer is None:
            return {"status": "error", "message": "Assessment mode not enabled."}

        from parser.water_parser import WaterReading
        from clustering.bloom_predictor import BloomPredictor
        from datetime import datetime, timezone, timedelta

        bloom = BloomPredictor()
        samples = sample_store.all()

        if not samples:
            return {"status": "ok", "message": "No samples in store.", "samples": [], "clusters": [], "spread": []}

        # Build WaterReading objects for clustering
        readings = []
        scored_samples = []
        base_time = datetime.now(timezone.utc)

        for i, s in enumerate(samples):
            score_result = contamination_scorer.compute(
                ph=s.get("ph", 7.0), tds=s.get("tds", 0),
                turbidity=s.get("turbidity", 0), temperature=s.get("temperature", 25),
            )

            bloom_risk = bloom.predict(
                temperature=s.get("temperature", 25),
                ph=s.get("ph", 7.0),
                turbidity=s.get("turbidity", 5.0),
            )

            source_result = source_id.identify_with_details(
                s.get("tds", 0), s.get("turbidity", 0),
                s.get("ph", 7.0), s.get("temperature", 25),
            )

            reading = WaterReading(
                temperature=s.get("temperature"),
                tds=s.get("tds"),
                turbidity=s.get("turbidity"),
                latitude=s.get("latitude"),
                longitude=s.get("longitude"),
                ph=s.get("ph"),
                contamination_score=score_result["score"],
                quality_label=score_result["quality_label"],
                bloom_risk=bloom_risk,
                timestamp=base_time + timedelta(seconds=i * 10),
            )
            readings.append(reading)

            scored_samples.append({
                **s,
                "contamination_score": score_result["score"],
                "quality_label": score_result["quality_label"],
                "wqi_label": score_result["label"],
                "bloom_risk": bloom_risk,
                "pollution_source": source_result["source"],
            })

        # DBSCAN clustering
        analysis_detector = type(detector)(eps_meters=800, min_samples=3)
        clusters = analysis_detector.detect(readings)

        cluster_results = []
        for c in clusters:
            avg_tds = _safe_mean([r.tds for r in c.readings if r.tds is not None])
            avg_turb = _safe_mean([r.turbidity for r in c.readings if r.turbidity is not None])
            avg_ph = _safe_mean([r.ph for r in c.readings if r.ph is not None], default=7.0)
            avg_temp = _safe_mean([r.temperature for r in c.readings if r.temperature is not None], default=25.0)
            avg_wqi = _safe_mean([r.contamination_score for r in c.readings if r.contamination_score is not None])

            source_result = source_id.identify_with_details(avg_tds, avg_turb, avg_ph, avg_temp)
            source_scores = source_result.get("scores", {})

            cluster_samples = _match_samples_to_cluster(c, scored_samples)
            cluster_name = _generate_cluster_name(c, cluster_samples, source_result["source"])

            cluster_results.append({
                "cluster_id": c.cluster_id,
                "cluster_name": cluster_name,
                "center": list(c.center),
                "reading_count": len(c.readings),
                "affected_radius_m": c.affected_radius_m,
                "severity": c.severity,
                "avg_wqi": round(avg_wqi, 1),
                "avg_tds": round(avg_tds, 0),
                "avg_turbidity": round(avg_turb, 1),
                "avg_ph": round(avg_ph, 1),
                "pollution_source": source_result["source"],
                "source_confidence": source_result["confidence"],
                "source_reasons": source_result["reasons"],
                "source_scores": source_scores,
                "sample_ids": [s.get("sample_id", "") for s in cluster_samples],
                "sample_locations": list(set(s.get("location_name", "") for s in cluster_samples if s.get("location_name"))),
            })

        # Noise points (samples not in any cluster)
        clustered_latlons = set()
        for c in clusters:
            for r in c.readings:
                if r.latitude and r.longitude:
                    clustered_latlons.add((round(r.latitude, 4), round(r.longitude, 4)))

        noise_samples = []
        for s in scored_samples:
            key = (round(s.get("latitude", 0), 4), round(s.get("longitude", 0), 4))
            if key not in clustered_latlons:
                noise_samples.append(s)

        # Per-cluster spread analysis
        spread_results = {}
        bodies = wb_store.get_bodies() if wb_store else {}
        connections = wb_store.get_connections() if wb_store else {}

        if bodies and connections and cluster_results:
            spread_analyzer = spread_analyzer_cls(bodies, connections, decay_factor=0.2)
            for cr in cluster_results:
                nearest_wb = _find_nearest_water_body(
                    cr["center"][0], cr["center"][1], bodies,
                )
                if nearest_wb:
                    raw_spread = spread_analyzer.analyze_spread(nearest_wb, cr["avg_wqi"])
                    spread_results[cr["cluster_id"]] = {
                        "source_water_body": nearest_wb,
                        "source_name": bodies[nearest_wb].get("name", nearest_wb),
                        "source_wqi": cr["avg_wqi"],
                        "cluster_name": cr["cluster_name"],
                        "results": spread_analyzer.to_summary(raw_spread),
                    }

        # Summary stats
        safe = sum(1 for s in scored_samples if s.get("quality_label") == "Safe")
        moderate = sum(1 for s in scored_samples if s.get("quality_label") == "Moderate")
        unsafe = sum(1 for s in scored_samples if s.get("quality_label") == "Unsafe")

        return {
            "status": "ok",
            "summary": {
                "total_samples": len(scored_samples),
                "safe": safe,
                "moderate": moderate,
                "unsafe": unsafe,
                "hotspots": len(cluster_results),
                "noise_points": len(noise_samples),
                "bloom_warnings": sum(1 for s in scored_samples if s.get("bloom_risk") in ("HIGH", "MODERATE")),
            },
            "samples": scored_samples,
            "clusters": cluster_results,
            "noise_samples": noise_samples,
            "spread": spread_results,
        }

    @app.post("/analysis/maps", summary="Regenerate maps from stored data")
    def regenerate_maps() -> Dict[str, Any]:
        """Regenerate all HTML maps from current stored samples + water body network."""
        try:
            from validation.generate_maps import (
                generate_sampling_map, generate_water_body_network_map,
                generate_hotspot_map, generate_spread_map, generate_combined_map,
                OUTPUT_DIR,
            )
            os.makedirs(OUTPUT_DIR, exist_ok=True)
            generate_sampling_map()
            generate_water_body_network_map()
            generate_hotspot_map()
            generate_spread_map()
            generate_combined_map()
            return {
                "status": "ok",
                "message": f"5 maps regenerated in {OUTPUT_DIR}",
                "maps": [
                    "1_sampling_points.html",
                    "2_water_body_network.html",
                    "3_hotspot_clusters.html",
                    "4_pollution_spread.html",
                    "5_combined_overview.html",
                ],
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ══════════════════════════════════════════════════════════════
    # CAUSALITY INTELLIGENCE ENDPOINTS
    # ══════════════════════════════════════════════════════════════

    _causality_cache: Dict[str, Any] = {"data": None, "ts": 0}

    def _causality_engine():
        return early_warning_holder.get("engine") if early_warning_holder else None

    @app.get("/causality", summary="Current causal analysis and prediction")
    def get_causality() -> Dict[str, Any]:
        engine = _causality_engine()
        if engine is None:
            return {"insufficient_data": True, "reading_count": 0, "minimum_required": 50,
                    "training": True}
        now = __import__("time").time()
        if _causality_cache["data"] and now - _causality_cache["ts"] < 30:
            return _causality_cache["data"]
        result = engine.get_current_state()
        _causality_cache["data"] = result
        _causality_cache["ts"] = now
        return result

    @app.get("/causality/history", summary="Last 20 early warnings")
    def get_causality_history() -> Dict[str, Any]:
        engine = _causality_engine()
        if engine is None:
            return {"warnings": []}
        return {"warnings": engine.get_warning_history()}

    # ══════════════════════════════════════════════════════════════
    # FIELD ANALYSIS ENDPOINTS (AquaVision — location agnostic)
    # ══════════════════════════════════════════════════════════════

    _pipeline_cache: Dict[str, Any] = {"data": None, "ts": 0}

    @app.get("/analysis/batch", summary="Batch analysis of all collected samples")
    def get_batch_analysis() -> Dict[str, Any]:
        from analysis.pipeline import AquaVisionPipeline
        from data.dataset import SampleDataset
        import time as _time

        now = _time.time()
        if _pipeline_cache["data"] and now - _pipeline_cache["ts"] < 30:
            return _pipeline_cache["data"]

        try:
            dataset = SampleDataset()
            pipeline = AquaVisionPipeline(skip_osm=False)
            samples = dataset.to_dicts()
            result = pipeline.run_batch_analysis(samples)
            _pipeline_cache["data"] = result
            _pipeline_cache["ts"] = now
            return result
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @app.post("/analysis/live", summary="Live reading analysis — location agnostic")
    async def post_live_analysis(data: LiveAnalysisInput) -> Dict[str, Any]:
        from analysis.pipeline import AquaVisionPipeline
        from data.dataset import SampleDataset

        try:
            dataset = SampleDataset()
            pipeline = AquaVisionPipeline(skip_osm=False)
            stored = dataset.to_dicts()

            live = {
                "tds": data.tds,
                "turbidity": data.turbidity,
                "ph": data.ph,
                "temperature": data.temperature,
                "lat": data.lat,
                "lon": data.lon,
            }

            wb_override = None
            if data.water_body_type:
                wb_override = {
                    "type": data.water_body_type,
                    "flow_velocity_ms": data.flow_velocity_ms if data.flow_velocity_ms is not None else 0.3,
                }

            result = await pipeline.run_live_async(live, stored, wb_override)
            return result
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @app.get("/analysis/collected-samples", summary="Get all collected samples with WQS scores")
    def get_collected_samples() -> Dict[str, Any]:
        from analysis.wqs_engine import WQSEngine
        from data.dataset import SampleDataset

        try:
            dataset = SampleDataset()
            wqs = WQSEngine()
            samples = dataset.to_dicts()
            scored = []
            for s in samples:
                result = wqs.compute(
                    tds=s.get("tds", 0),
                    turbidity=s.get("turbidity", 0),
                    ph=s.get("ph", 7.0),
                    temperature=s.get("temperature", 25.0),
                )
                scored.append({**s, **result})
            return {"status": "ok", "count": len(scored), "samples": scored}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @app.post("/analysis/spread", summary="Spread estimation for specific coordinates")
    def post_spread_analysis(data: LiveAnalysisInput) -> Dict[str, Any]:
        from analysis.pipeline import AquaVisionPipeline

        try:
            pipeline = AquaVisionPipeline(skip_osm=False)
            wqs_result = pipeline.wqs.compute(
                tds=data.tds, turbidity=data.turbidity,
                ph=data.ph, temperature=data.temperature,
            )
            wb_override = None
            if data.water_body_type:
                wb_override = {
                    "type": data.water_body_type,
                    "flow_velocity_ms": data.flow_velocity_ms if data.flow_velocity_ms is not None else 0.3,
                }
            wb = None
            if data.lat and data.lon:
                try:
                    wb = pipeline.spread.find_water_body(data.lat, data.lon)
                except Exception:
                    pass

            result = pipeline.spread.estimate_spread(
                wqs=wqs_result["wqs"],
                lat=data.lat or 0,
                lon=data.lon or 0,
                water_body=wb,
                water_body_override=wb_override,
            )
            return {"status": "ok", **result}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @app.post("/analysis/live/stream", summary="SSE streaming live analysis")
    async def stream_live_analysis(data: LiveAnalysisInput):
        from analysis.pipeline import AquaVisionPipeline
        from data.dataset import SampleDataset

        dataset = SampleDataset()
        pipeline = AquaVisionPipeline(skip_osm=False)
        stored = dataset.to_dicts()

        live = {
            "tds": data.tds, "turbidity": data.turbidity,
            "ph": data.ph, "temperature": data.temperature,
            "lat": data.lat, "lon": data.lon,
        }
        wb_override = None
        if data.water_body_type:
            wb_override = {
                "type": data.water_body_type,
                "flow_velocity_ms": data.flow_velocity_ms if data.flow_velocity_ms is not None else 0.3,
            }

        async def event_generator():
            try:
                async for step in pipeline.run_live_streaming(live, stored, wb_override):
                    yield f"data: {json.dumps(step, default=str)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'step': 'error', 'data': str(e)})}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/analysis/source", summary="Chemical-only source fingerprint (fast)")
    def post_source_analysis(data: LiveAnalysisInput) -> Dict[str, Any]:
        from analysis.source_engine import SourceIdentifier, SOURCE_PROFILES

        try:
            identifier = SourceIdentifier()
            result = identifier.identify(
                tds=data.tds, turbidity=data.turbidity, ph=data.ph,
                skip_osm=True,
            )
            profiles = {
                SOURCE_PROFILES[k]["label"]: {
                    "tds_center": SOURCE_PROFILES[k]["tds_center"],
                    "turbidity_center": SOURCE_PROFILES[k]["turbidity_center"],
                    "ph_center": SOURCE_PROFILES[k]["ph_center"],
                    "description": SOURCE_PROFILES[k]["description"],
                }
                for k in SOURCE_PROFILES
            }
            return {"status": "ok", **result, "profiles": profiles}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @app.post("/analysis/historical_sample", summary="Analyze a historical sample")
    async def post_historical_sample(data: HistoricalSampleInput) -> Dict[str, Any]:
        from analysis.pipeline import AquaVisionPipeline

        try:
            pipeline = AquaVisionPipeline(skip_osm=False)

            wqs_result = pipeline.wqs.compute(
                tds=data.tds, turbidity=data.turbidity,
                ph=data.ph, temperature=25.0,
            )

            source_result = pipeline.source.identify(
                tds=data.tds, turbidity=data.turbidity, ph=data.ph,
                skip_osm=True,
            )

            wb = None
            spread_result = None
            if data.lat and data.lon and wqs_result["wqs"] >= 0.15:
                try:
                    wb = await asyncio.to_thread(
                        pipeline.spread.find_water_body, data.lat, data.lon,
                    )
                except Exception:
                    pass

                spread_result = pipeline.spread.estimate_spread(
                    wqs=wqs_result["wqs"],
                    lat=data.lat, lon=data.lon,
                    water_body=wb,
                )

            return {
                "status": "ok",
                "wqs": wqs_result,
                "source": source_result,
                "spread": spread_result,
                "water_body": {
                    "name": wb.get("name", "unknown") if wb else None,
                    "type": wb.get("type", "not_found") if wb else "not_found",
                } if wb else None,
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @app.post("/analysis/set_water_body", summary="Re-run pipeline with water body override")
    async def post_set_water_body(data: LiveAnalysisInput) -> Dict[str, Any]:
        from analysis.pipeline import AquaVisionPipeline
        from data.dataset import SampleDataset

        try:
            dataset = SampleDataset()
            pipeline = AquaVisionPipeline(skip_osm=False)
            stored = dataset.to_dicts()

            live = {
                "tds": data.tds, "turbidity": data.turbidity,
                "ph": data.ph, "temperature": data.temperature,
                "lat": data.lat, "lon": data.lon,
            }
            wb_override = {
                "type": data.water_body_type or "river",
                "flow_velocity_ms": data.flow_velocity_ms if data.flow_velocity_ms is not None else 0.3,
            }

            result = await pipeline.run_live_async(live, stored, wb_override)
            return result
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ── Helper functions ──────────────────────────────────────────

    def _check_cluster_membership(sample: dict, det, src_id, scorer) -> dict:
        """Check if new sample joins an existing cluster or creates a new one."""
        from parser.water_parser import WaterReading
        from datetime import datetime, timezone, timedelta

        if sample_store is None:
            return {"status": "unknown"}

        all_samples = sample_store.all()
        readings = []
        base_time = datetime.now(timezone.utc)
        for i, s in enumerate(all_samples):
            readings.append(WaterReading(
                latitude=s.get("latitude"), longitude=s.get("longitude"),
                tds=s.get("tds"), turbidity=s.get("turbidity"),
                ph=s.get("ph"), temperature=s.get("temperature"),
                contamination_score=s.get("contamination_score"),
                timestamp=base_time + timedelta(seconds=i * 10),
            ))

        analysis_det = type(det)(eps_meters=800, min_samples=3)
        clusters = analysis_det.detect(readings)

        sample_lat = sample.get("latitude", 0)
        sample_lon = sample.get("longitude", 0)

        for c in clusters:
            for r in c.readings:
                if (r.latitude and r.longitude and
                    abs(r.latitude - sample_lat) < 0.0001 and
                    abs(r.longitude - sample_lon) < 0.0001):
                    return {
                        "status": "joined_cluster",
                        "cluster_id": c.cluster_id,
                        "cluster_severity": c.severity,
                        "cluster_size": len(c.readings),
                        "total_clusters": len(clusters),
                    }

        return {
            "status": "isolated",
            "message": "Sample not part of any cluster (noise point or insufficient nearby samples)",
            "total_clusters": len(clusters),
        }

    return app


def _match_samples_to_cluster(cluster, scored_samples: list) -> list:
    """Match cluster readings back to original sample records by lat/lon."""
    matched = []
    for r in cluster.readings:
        if r.latitude is None or r.longitude is None:
            continue
        for s in scored_samples:
            if (abs(s.get("latitude", 0) - r.latitude) < 0.0001 and
                abs(s.get("longitude", 0) - r.longitude) < 0.0001):
                matched.append(s)
                break
    return matched


def _generate_cluster_name(cluster, cluster_samples: list, source_type: str) -> str:
    """Generate a meaningful name for a cluster from its samples' locations."""
    location_names = [s.get("location_name", "") for s in cluster_samples if s.get("location_name")]

    area_keywords = {}
    for name in location_names:
        for keyword in ["Nayandahalli", "Mysore Road", "RVCE", "Campus", "Jnana Bharathi",
                        "Kengeri", "Kommaghatta", "Agricultural"]:
            if keyword.lower() in name.lower():
                area_keywords[keyword] = area_keywords.get(keyword, 0) + 1

    source_labels = {
        "Industrial Discharge": "Industrial Zone",
        "Sewage Contamination": "Residential Zone",
        "Agricultural Runoff": "Agricultural Zone",
        "Natural/Background": "Natural Zone",
    }
    zone_type = source_labels.get(source_type, "Zone")

    if area_keywords:
        dominant_area = max(area_keywords, key=area_keywords.get)
        return f"{zone_type} — {dominant_area}"

    lat, lon = cluster.center
    if lat > 12.94:
        return f"{zone_type} — Upstream"
    elif lat > 12.92:
        return f"{zone_type} — Midstream"
    else:
        return f"{zone_type} — Downstream"


def _safe_mean(values: list, default: float = 0.0) -> float:
    return float(np.mean(values)) if values else default


def _find_nearest_water_body(lat: float, lon: float, bodies: dict) -> str | None:
    """Find nearest water body to a GPS coordinate."""
    if not bodies:
        return None
    nearest = None
    min_dist = float("inf")
    for wb_id, wb in bodies.items():
        wb_lat = wb.get("latitude", 0)
        wb_lon = wb.get("longitude", 0)
        dist = math.sqrt((lat - wb_lat) ** 2 + (lon - wb_lon) ** 2)
        if dist < min_dist:
            min_dist = dist
            nearest = wb_id
    return nearest
