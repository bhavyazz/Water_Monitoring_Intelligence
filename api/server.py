"""
server.py — FastAPI Backend API

Endpoints:
  GET /data      → latest processed reading
  GET /history   → last N readings (query param ?n=50)
  GET /clusters  → pollution hotspot clusters (JSON + GeoJSON)
  GET /alerts    → water quality + algal bloom alerts
"""

from __future__ import annotations
from typing import List, Dict, Any
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware


def create_app(storage, detector, source_id, spread_analyzer, geojson_builder) -> FastAPI:
    """
    Factory that creates and configures the FastAPI application.

    Args:
        storage:          StorageEngine instance.
        detector:         HotspotDetector instance.
        source_id:        SourceIdentifier instance.
        spread_analyzer:  SpreadAnalyzer class (static methods).
        geojson_builder:  GeoJSONBuilder class (static methods).

    Returns:
        Configured FastAPI app.
    """
    app = FastAPI(
        title="Water Quality Monitoring API",
        description="AI + IoT backend for intelligent water quality monitoring and pollution analysis.",
        version="1.0.0",
    )

    # Allow all origins for development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── GET /data — latest processed reading ──────────────────────

    @app.get("/data", summary="Latest processed reading")
    def get_latest_data() -> Dict[str, Any]:
        reading = storage.latest()
        if reading is None:
            return {"status": "no_data", "reading": None}
        return {"status": "ok", "reading": reading.to_dict()}

    # ── GET /history — last N readings ────────────────────────────

    @app.get("/history", summary="Last N readings")
    def get_history(n: int = Query(default=50, ge=1, le=500)) -> Dict[str, Any]:
        readings = storage.last_n(n)
        return {
            "status": "ok",
            "count": len(readings),
            "readings": [r.to_dict() for r in readings],
        }

    # ── GET /clusters — pollution hotspots ────────────────────────

    @app.get("/clusters", summary="Pollution hotspot clusters")
    def get_clusters() -> Dict[str, Any]:
        all_readings = storage.all()
        clusters = detector.detect(all_readings)

        # Enrich each cluster with source + spread info
        for c in clusters:
            c.probable_source = source_id.identify(c.center[0], c.center[1])
            direction, speed = spread_analyzer.analyze(c.readings)
            c.spread_direction = direction
            c.spread_speed = speed

        geojson = geojson_builder.build(clusters)

        return {
            "status": "ok",
            "cluster_count": len(clusters),
            "clusters": [c.to_dict() for c in clusters],
            "geojson": geojson,
        }

    # ── GET /alerts — quality + bloom alerts ──────────────────────

    @app.get("/alerts", summary="Water quality and bloom alerts")
    def get_alerts() -> Dict[str, Any]:
        recent = storage.last_n(20)
        alerts: List[Dict[str, Any]] = []

        for r in recent:
            entry_alerts = []
            if r.quality_label == "Unsafe":
                entry_alerts.append({
                    "type": "water_quality",
                    "level": "CRITICAL",
                    "message": f"Unsafe water detected — TDS={r.tds}, Turb={r.turbidity}",
                })
            elif r.quality_label == "Moderate":
                entry_alerts.append({
                    "type": "water_quality",
                    "level": "WARNING",
                    "message": f"Moderate degradation — TDS={r.tds}, Turb={r.turbidity}",
                })

            if r.bloom_risk == "HIGH":
                entry_alerts.append({
                    "type": "algal_bloom",
                    "level": "CRITICAL",
                    "message": f"High algal bloom risk — Nitrate={r.nitrate}, Temp={r.temperature}",
                })
            elif r.bloom_risk == "MODERATE":
                entry_alerts.append({
                    "type": "algal_bloom",
                    "level": "WARNING",
                    "message": f"Moderate bloom risk — Nitrate={r.nitrate}",
                })

            if entry_alerts:
                alerts.append({
                    "timestamp": r.timestamp.isoformat(),
                    "location": [r.latitude, r.longitude],
                    "alerts": entry_alerts,
                })

        return {
            "status": "ok",
            "alert_count": len(alerts),
            "alerts": alerts,
        }

    return app
