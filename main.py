"""
main.py — System Entry Point

Wires together every module and runs the complete pipeline:

  Simulated Data → Parser → Preprocessing →
  ML Models → Rule Engine → Storage → API

Architecture:
  • A background thread runs the simulator + pipeline loop.
  • The FastAPI server runs on the main thread (uvicorn).
  • All processed readings are stored in a shared StorageEngine.
  • API endpoints query the storage and run clustering on demand.
"""

import sys
import os
import threading
import logging
import time

# ── Ensure project root is on sys.path ───────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn

# ── Local modules ─────────────────────────────────────────────────────
from simulator.data_simulator import DataSimulator
from parser.water_parser import WaterParser
from preprocessing.preprocessor import Preprocessor
from models.nitrate_model import NitratePredictor
from models.quality_classifier import WaterQualityClassifier
from clustering.bloom_predictor import BloomPredictor
from clustering.hotspot_detector import HotspotDetector
from clustering.source_identifier import SourceIdentifier
from clustering.spread_analyzer import SpreadAnalyzer
from utils.storage import StorageEngine
from utils.geojson_builder import GeoJSONBuilder
from api.server import create_app

# ── Logging ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


def pipeline_loop(
    simulator: DataSimulator,
    parser: WaterParser,
    preprocessor: Preprocessor,
    nitrate_model: NitratePredictor,
    quality_clf: WaterQualityClassifier,
    bloom_predictor: BloomPredictor,
    storage: StorageEngine,
    interval: float = 2.0,
) -> None:
    """
    Infinite loop that:
      1. Generates a simulated sensor string
      2. Parses it into a WaterReading
      3. Smooths TDS / Turbidity
      4. Predicts nitrate from RGB
      5. Classifies water quality
      6. Assesses algal bloom risk
      7. Stores the enriched reading

    Runs in a daemon thread so it does not block the API server.
    """
    logger.info("Pipeline loop started (interval=%.1fs).", interval)

    for raw_line in simulator.stream(interval=interval):
        # ── Step 1: Parse ──────────────────────────────────────────
        reading = parser.parse(raw_line)
        if reading is None:
            logger.warning("Unparseable line — skipped.")
            continue

        # ── Step 2: Preprocess (smooth + normalise) ────────────────
        preprocessor.process(reading)

        # ── Step 3: Nitrate prediction ─────────────────────────────
        rgb_norm = getattr(reading, "_rgb_norm", None)
        if rgb_norm is not None:
            reading.nitrate = nitrate_model.predict(rgb_norm)

        # ── Step 4: Water quality classification ───────────────────
        if all(v is not None for v in [reading.tds, reading.turbidity, reading.nitrate, reading.temperature]):
            reading.quality_label = quality_clf.classify(
                reading.tds, reading.turbidity, reading.nitrate, reading.temperature,
            )

        # ── Step 5: Algal bloom risk ───────────────────────────────
        if reading.nitrate is not None and reading.temperature is not None:
            reading.bloom_risk = bloom_predictor.predict(reading.nitrate, reading.temperature)

        # ── Step 6: Store ──────────────────────────────────────────
        storage.add(reading)

        logger.info(
            "Reading #%d | TDS=%.1f | Turb=%.2f | Nitrate=%.2f | Quality=%s | Bloom=%s",
            storage.count(),
            reading.tds or 0,
            reading.turbidity or 0,
            reading.nitrate or 0,
            reading.quality_label or "?",
            reading.bloom_risk or "?",
        )


def main() -> None:
    """Initialise all components and start the system."""

    logger.info("=" * 60)
    logger.info("  Water Quality Monitoring System — Starting Up")
    logger.info("=" * 60)

    # ── Instantiate components ────────────────────────────────────
    simulator = DataSimulator(seed=42)
    parser = WaterParser()
    preprocessor = Preprocessor(window_size=5)

    logger.info("Training ML models...")
    nitrate_model = NitratePredictor(n_samples=2000)
    quality_clf = WaterQualityClassifier(n_samples=3000)
    bloom_predictor = BloomPredictor()

    storage = StorageEngine(capacity=500)
    detector = HotspotDetector(eps_meters=200, min_samples=3)
    source_id = SourceIdentifier(enable_network=True)

    logger.info("All components initialised.")

    # ── Start background pipeline thread ──────────────────────────
    pipeline_thread = threading.Thread(
        target=pipeline_loop,
        args=(simulator, parser, preprocessor, nitrate_model, quality_clf, bloom_predictor, storage),
        kwargs={"interval": 2.0},
        daemon=True,
        name="PipelineThread",
    )
    pipeline_thread.start()
    logger.info("Pipeline thread started.")

    # ── Create and run FastAPI server ─────────────────────────────
    app = create_app(storage, detector, source_id, SpreadAnalyzer, GeoJSONBuilder)

    logger.info("Starting API server on http://0.0.0.0:8000")
    logger.info("  Docs:  http://localhost:8000/docs")
    logger.info("=" * 60)

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
