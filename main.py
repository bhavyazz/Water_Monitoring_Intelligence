"""
main.py -- System Entry Point

Wires together every module and runs the complete pipeline:

  Arduino Sensor -> Parser -> Preprocessing ->
  pH Model -> Contamination Scorer -> ML Classifier -> Bloom Indicator -> Storage -> API

Architecture:
  - A background thread runs the sensor-reading + pipeline loop.
  - The FastAPI server runs on the main thread (uvicorn).
  - All processed readings are stored in a shared StorageEngine.
  - Vrushabavathi/RVCE case study data preloaded by default.
  - API endpoints query the storage and run clustering on demand.

Modes (default is Arduino serial + preloaded RVCE data):
  (default)      Arduino serial + RVCE preloaded + API server.
  --simulate     Use built-in data simulator instead of Arduino.
  --case-study   Run Vrushabavathi case study (print-only validation).
"""

import sys
import os
import argparse
import threading
import logging
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn

from simulator.data_simulator import DataSimulator
from simulator.arduino_serial import ArduinoSerialReader, list_serial_ports
from parser.water_parser import WaterParser, WaterReading
from preprocessing.preprocessor import Preprocessor
from models.ph_model import pHPredictor
from models.contamination_scorer import ContaminationScorer
from models.quality_classifier import WaterQualityClassifier
from clustering.bloom_predictor import BloomPredictor
from clustering.hotspot_detector import HotspotDetector
from clustering.source_identifier import SourceIdentifier
from clustering.spread_analyzer import SpreadAnalyzer
from utils.storage import StorageEngine
from utils.geojson_builder import GeoJSONBuilder
from api.server import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")

logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
logging.getLogger("uvicorn").setLevel(logging.WARNING)


def _haversine_m(lat1, lon1, lat2, lon2):
    """Distance in meters between two GPS points."""
    import math
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def pipeline_loop(
    data_source,
    parser: WaterParser,
    preprocessor: Preprocessor,
    ph_model: pHPredictor,
    contamination_scorer: ContaminationScorer,
    quality_classifier: WaterQualityClassifier,
    bloom_predictor: BloomPredictor,
    storage: StorageEngine,
    sample_store=None,
    source_identifier=None,
    interval: float = 2.0,
) -> None:
    """
    Infinite loop:
      1. Read sensor string (Arduino or simulator)
      2. Parse into WaterReading
      3. Smooth TDS / Turbidity
      4. Predict pH from RGB
      5. Compute contamination score (WQI)
      6. ML classify: Safe/Moderate/Unsafe
      7. Assess bloom risk
      8. Store enriched reading
      9. Auto-add to sample_store when location changes (>100m)
    """
    logger.info("Pipeline loop started (interval=%.1fs).", interval)
    last_sample_lat, last_sample_lon = None, None
    live_sample_count = 0

    for raw_line in data_source.stream(interval=interval):
        reading = parser.parse(raw_line)
        if reading is None:
            logger.warning("Unparseable line -- skipped.")
            continue

        preprocessor.process(reading)

        reading.sensor_mode = "pH"
        rgb_norm = getattr(reading, "_rgb_norm", None)
        if rgb_norm is not None:
            reading.ph = ph_model.predict(rgb_norm)

        if all(v is not None for v in [reading.tds, reading.turbidity, reading.temperature]):
            result = contamination_scorer.compute(
                ph=reading.ph if reading.ph is not None else 7.0,
                tds=reading.tds,
                turbidity=reading.turbidity,
                temperature=reading.temperature,
            )
            reading.contamination_score = result["score"]

            ml_result = quality_classifier.classify_with_proba(
                tds=reading.tds,
                turbidity=reading.turbidity,
                ph=reading.ph if reading.ph is not None else 7.0,
            )
            reading.quality_label = ml_result["label"]

        if reading.temperature is not None:
            reading.bloom_risk = bloom_predictor.predict(
                temperature=reading.temperature,
                ph=reading.ph if reading.ph is not None else 7.0,
                turbidity=reading.turbidity if reading.turbidity is not None else 5.0,
            )

        storage.add(reading)

        # Auto-add to sample_store when GPS location changes >100m
        if (sample_store is not None and source_identifier is not None
                and reading.latitude is not None and reading.longitude is not None
                and reading.tds is not None):
            should_add = False
            if last_sample_lat is None:
                should_add = True
            else:
                dist = _haversine_m(last_sample_lat, last_sample_lon, reading.latitude, reading.longitude)
                if dist > 100:
                    should_add = True

            if should_add:
                live_sample_count += 1
                src = source_identifier.identify_with_details(
                    reading.tds, reading.turbidity or 0,
                    reading.ph or 7.0, reading.temperature or 25,
                )
                sample_store.add({
                    "sample_id": f"LIVE-{live_sample_count:03d}",
                    "latitude": reading.latitude,
                    "longitude": reading.longitude,
                    "tds": reading.tds,
                    "turbidity": reading.turbidity or 0,
                    "ph": reading.ph or 7.0,
                    "temperature": reading.temperature or 25,
                    "location_name": f"Live Sensor Point {live_sample_count}",
                    "contamination_score": reading.contamination_score,
                    "quality_label": reading.quality_label,
                    "pollution_source": src["source"],
                    "source_confidence": src["confidence"],
                    "source_reasons": src["reasons"],
                    "notes": "Auto-captured from live sensor",
                })
                last_sample_lat = reading.latitude
                last_sample_lon = reading.longitude
                logger.info("Live sample LIVE-%03d auto-added at (%.4f, %.4f)",
                            live_sample_count, reading.latitude, reading.longitude)

        logger.info(
            "Reading #%d | TDS=%.1f | Turb=%.2f | pH=%s | WQI=%.1f/%s | Bloom=%s",
            storage.count(),
            reading.tds or 0,
            reading.turbidity or 0,
            f"{reading.ph:.2f}" if reading.ph is not None else "--",
            reading.contamination_score or 0,
            reading.quality_label or "?",
            reading.bloom_risk or "?",
        )


def run_case_study() -> None:
    """Run Vrushabavathi case study for validation/demonstration."""
    from data.vrushabavathi_case_study import (
        ALL_SAMPLING_POINTS, WATER_BODIES, WATER_BODY_CONNECTIONS,
        CLUSTER_A_INDUSTRIAL, CLUSTER_B_RESIDENTIAL, CLUSTER_C_AGRICULTURAL,
        ISOLATED_POINTS,
    )
    from datetime import datetime, timezone, timedelta

    logger.info("=" * 60)
    logger.info("  Vrushabavathi River Case Study — Validation Mode")
    logger.info("=" * 60)

    scorer = ContaminationScorer()
    source_id = SourceIdentifier()
    detector = HotspotDetector(eps_meters=800, min_samples=3)

    # Convert water bodies to dict format for SpreadAnalyzer
    wb_dict = {}
    for wb_id, wb in WATER_BODIES.items():
        wb_dict[wb_id] = {
            "name": wb.name,
            "latitude": wb.latitude,
            "longitude": wb.longitude,
            "body_type": wb.body_type,
        }

    spread = SpreadAnalyzer(wb_dict, WATER_BODY_CONNECTIONS, decay_factor=0.2)
    bloom = BloomPredictor()

    # ── Step 1: Contamination scoring for all samples ─────────────
    print("\n" + "=" * 70)
    print("  STEP 1: CONTAMINATION ASSESSMENT (WQI — BIS 10500 / WHO)")
    print("=" * 70)
    print(f"{'ID':<5} {'Location':<35} {'TDS':>5} {'Turb':>5} {'pH':>5} {'Temp':>5} | {'WQI':>5} {'Label':<10}")
    print("-" * 85)

    readings = []
    base_time = datetime.now(timezone.utc)
    for i, sp in enumerate(ALL_SAMPLING_POINTS):
        result = scorer.compute(sp.ph, sp.tds, sp.turbidity, sp.temperature)
        print(f"{sp.sample_id:<5} {sp.location_name:<35} {sp.tds:>5.0f} {sp.turbidity:>5.1f} "
              f"{sp.ph:>5.1f} {sp.temperature:>5.1f} | {result['score']:>5.1f} {result['label']:<10}")

        reading = WaterReading(
            temperature=sp.temperature,
            tds=sp.tds,
            turbidity=sp.turbidity,
            latitude=sp.latitude,
            longitude=sp.longitude,
            rgb=sp.rgb,
            ph=sp.ph,
            contamination_score=result["score"],
            quality_label=result["quality_label"],
            timestamp=base_time + timedelta(seconds=i * 10),
        )
        reading.bloom_risk = bloom.predict(sp.temperature, sp.ph, sp.turbidity)
        readings.append(reading)

    # ── Step 2: Hotspot Detection (DBSCAN) ────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 2: HOTSPOT DETECTION (DBSCAN)")
    print("=" * 70)

    clusters = detector.detect(readings)
    print(f"\nClusters found: {len(clusters)} (noise points excluded)")

    for c in clusters:
        avg_tds = float(sum(r.tds for r in c.readings if r.tds) / len(c.readings))
        avg_turb = float(sum(r.turbidity for r in c.readings if r.turbidity) / len(c.readings))
        avg_ph = float(sum(r.ph for r in c.readings if r.ph) / len(c.readings))
        avg_temp = float(sum(r.temperature for r in c.readings if r.temperature) / len(c.readings))
        avg_score = float(sum(r.contamination_score for r in c.readings if r.contamination_score) / len(c.readings))

        print(f"\n  Cluster {c.cluster_id}:")
        print(f"    Center:    ({c.center[0]:.4f}, {c.center[1]:.4f})")
        print(f"    Readings:  {len(c.readings)}")
        print(f"    Radius:    {c.affected_radius_m:.0f} m")
        print(f"    Severity:  {c.severity}")
        print(f"    Avg TDS:   {avg_tds:.0f} ppm")
        print(f"    Avg Turb:  {avg_turb:.1f} NTU")
        print(f"    Avg pH:    {avg_ph:.1f}")
        print(f"    Avg WQI:   {avg_score:.1f}")

        # ── Step 3: Source Attribution ────────────────────────────
        source = source_id.identify(avg_tds, avg_turb, avg_ph, avg_temp)
        details = source_id.identify_with_details(avg_tds, avg_turb, avg_ph, avg_temp)
        c.probable_source = source
        print(f"    Source:    {source} (confidence: {details['confidence']})")
        for reason in details["reasons"]:
            print(f"      > {reason}")

    # ── Step 4: Pollution Spread Analysis ─────────────────────────
    print("\n" + "=" * 70)
    print("  STEP 3: POLLUTION SPREAD ANALYSIS (Distance-Decay Model)")
    print("=" * 70)

    if clusters:
        worst = max(clusters, key=lambda c: sum(
            r.contamination_score or 0 for r in c.readings) / max(len(c.readings), 1))
        worst_score = sum(r.contamination_score or 0 for r in worst.readings) / len(worst.readings)

        nearest_wb = min(
            WATER_BODIES.keys(),
            key=lambda wb_id: (
                (WATER_BODIES[wb_id].latitude - worst.center[0]) ** 2 +
                (WATER_BODIES[wb_id].longitude - worst.center[1]) ** 2
            ),
        )

        print(f"\n  Source: {WATER_BODIES[nearest_wb].name}")
        print(f"  Contamination Score: {worst_score:.1f}")
        print(f"  Decay factor (lambda): {spread.decay_factor}")
        print(f"\n  {'Water Body':<40} {'Risk':>6} {'Level':<12} {'Distance':>8} {'Path'}")
        print("  " + "-" * 90)

        spread_results = spread.analyze_spread(nearest_wb, worst_score)
        for r in spread_results:
            path_str = " ->".join(r.path_from_source[-2:]) if len(r.path_from_source) > 1 else "source"
            print(f"  {r.water_body_name:<40} {r.risk_score:>6.1f} {r.risk_level:<12} "
                  f"{r.distance_from_source:>6.1f} km  {path_str}")

    # ── Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("  SUMMARY")
    print("=" * 70)
    safe = sum(1 for r in readings if r.quality_label == "Safe")
    moderate = sum(1 for r in readings if r.quality_label == "Moderate")
    unsafe = sum(1 for r in readings if r.quality_label == "Unsafe")
    print(f"  Total samples:  {len(readings)}")
    print(f"  Safe:           {safe}")
    print(f"  Moderate:       {moderate}")
    print(f"  Unsafe:         {unsafe}")
    print(f"  Hotspots:       {len(clusters)}")
    print(f"  Bloom warnings: {sum(1 for r in readings if r.bloom_risk in ('HIGH', 'MODERATE'))}")
    print("=" * 70)


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Water Quality Monitoring System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--simulate", action="store_true",
                       help="Use built-in data simulator instead of Arduino.")
    mode.add_argument("--case-study", action="store_true",
                       help="Run Vrushabavathi river case study (print-only validation).")

    ap.add_argument("--port", type=str, default=None,
                     help="Serial port for Arduino (e.g. COM3).")
    ap.add_argument("--baud", type=int, default=115200,
                     help="Serial baud rate (default: 115200).")
    ap.add_argument("--interval", type=float, default=2.0,
                     help="Pipeline loop interval in seconds (default: 2.0).")
    ap.add_argument("--api-port", type=int, default=8000,
                     help="API server port (default: 8000).")
    ap.add_argument("--list-ports", action="store_true",
                     help="Print available serial ports and exit.")
    ap.add_argument("--no-preload", action="store_true",
                     help="Skip preloading Vrushabavathi/RVCE case study data.")

    return ap


def main() -> None:
    args = build_arg_parser().parse_args()

    if args.list_ports:
        ports = list_serial_ports()
        if ports:
            print("Available serial ports:")
            for p in ports:
                print(f"  - {p}")
        else:
            print("No serial ports detected.")
        return

    # ── Case study mode (print-only, no server) ───────────────────
    if args.case_study:
        run_case_study()
        return

    logger.info("=" * 60)
    logger.info("  Water Quality Monitoring System -- Starting Up")
    logger.info("=" * 60)

    # ── Shared components ─────────────────────────────────────────
    contamination_scorer = ContaminationScorer()
    bloom_predictor = BloomPredictor()
    storage = StorageEngine(capacity=500)
    detector = HotspotDetector(eps_meters=200, min_samples=3)
    source_id = SourceIdentifier()

    # ── Persistent stores (always active, RVCE preloaded by default) ──
    from data.sample_store import SampleStore, WaterBodyStore, preload_vrushabavathi
    sample_store = SampleStore()
    wb_store = WaterBodyStore()

    if not args.no_preload:
        preload_vrushabavathi(sample_store, wb_store)
        logger.info("Vrushabavathi/RVCE case study data preloaded (20 samples, 9 water bodies).")

    # ── Data source (Arduino if present, else auto-fallback to simulator) ──
    if args.simulate:
        data_source = DataSimulator(seed=42)
        logger.info("Mode: SIMULATOR (forced via --simulate)")
    else:
        port = args.port
        if port is None:
            ports = list_serial_ports()
            if not ports:
                logger.warning("No Arduino/serial port found — falling back to SIMULATOR.")
                data_source = DataSimulator(seed=42)
                logger.info("Mode: SIMULATOR (no sensor connected). Connect Arduino and restart for live data.")
            else:
                port = ports[0]
                logger.info("Auto-detected serial port: %s", port)
                data_source = ArduinoSerialReader(port=port, baudrate=args.baud)
                logger.info("Mode: LIVE ARDUINO (port=%s, baud=%d)", port, args.baud)
        else:
            data_source = ArduinoSerialReader(port=port, baudrate=args.baud)
            logger.info("Mode: LIVE ARDUINO (port=%s, baud=%d)", port, args.baud)

    # ── Start pipeline thread if sensor is available ──────────────
    if data_source is not None:
        parser = WaterParser()
        preprocessor = Preprocessor(window_size=5)

        logger.info("Initializing models...")
        ph_model = pHPredictor(n_samples=2000)
        quality_classifier = WaterQualityClassifier()
        logger.info("All components initialised.")

        pipeline_thread = threading.Thread(
            target=pipeline_loop,
            args=(data_source, parser, preprocessor, ph_model,
                  contamination_scorer, quality_classifier, bloom_predictor, storage),
            kwargs={"interval": args.interval, "sample_store": sample_store, "source_identifier": source_id},
            daemon=True,
            name="PipelineThread",
        )
        pipeline_thread.start()
        logger.info("Pipeline thread started.")

    # ── Causality intelligence engine (trained in background) ─────
    # Training takes ~55s. Run it in a daemon thread so the API server
    # binds immediately instead of refusing connections during startup.
    # The /causality endpoints read engine_holder["engine"] live.
    engine_holder = {"engine": None}

    def _train_causality():
        try:
            from causality.cpcb_loader import load_or_generate, get_event_windows
            from causality.causality_engine import PollutionEventLabeler, EarlyWarningEngine

            logger.info("Training causality classifier on CPCB data (background)...")
            cpcb_df = load_or_generate()
            labeler = PollutionEventLabeler()
            labeler.train(cpcb_df, get_event_windows())
            engine = EarlyWarningEngine(storage, labeler, check_interval=10)
            engine.start()
            engine_holder["engine"] = engine
            logger.info("Causality intelligence engine ready.")
        except Exception as e:
            logger.warning("Causality engine failed to initialize: %s", e)

    threading.Thread(target=_train_causality, daemon=True, name="CausalityTrain").start()

    # ── Start API server (always) ─────────────────────────────────
    app = create_app(
        storage, detector, source_id, SpreadAnalyzer, GeoJSONBuilder,
        sample_store=sample_store, wb_store=wb_store,
        contamination_scorer=contamination_scorer,
        early_warning_holder=engine_holder,
    )

    logger.info("Starting API server on http://0.0.0.0:%d", args.api_port)
    logger.info("  Docs:     http://localhost:%d/docs", args.api_port)
    logger.info("  Frontend: http://localhost:5173")
    logger.info("=" * 60)

    uvicorn.run(app, host="0.0.0.0", port=args.api_port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
