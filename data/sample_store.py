"""
sample_store.py -- Persistent JSON-based store for field samples and water body network.

Supports any location. Samples are geotagged, scored, and stored.
Water body network is a separate graph that can be built incrementally.

Files:
    data/samples.json       -- All collected water samples
    data/water_bodies.json  -- Water body nodes + connections
"""

from __future__ import annotations
import json
import os
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLES_FILE = os.path.join(DATA_DIR, "samples.json")
WATER_BODIES_FILE = os.path.join(DATA_DIR, "water_bodies.json")


class SampleStore:
    """Thread-safe persistent store for water quality samples."""

    def __init__(self):
        self._lock = threading.Lock()
        self._samples: List[dict] = []
        self._load()

    def _load(self):
        if os.path.exists(SAMPLES_FILE):
            try:
                with open(SAMPLES_FILE, "r", encoding="utf-8") as f:
                    self._samples = json.load(f)
                logger.info("Loaded %d samples from %s", len(self._samples), SAMPLES_FILE)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Could not load samples: %s", e)
                self._samples = []
        else:
            self._samples = []

    def _save(self):
        with open(SAMPLES_FILE, "w", encoding="utf-8") as f:
            json.dump(self._samples, f, indent=2, ensure_ascii=False)

    def add(self, sample: dict) -> dict:
        """Add a new sample. Auto-generates ID and timestamp if missing."""
        with self._lock:
            if "sample_id" not in sample:
                sample["sample_id"] = f"S{len(self._samples) + 1:03d}"
            if "timestamp" not in sample:
                sample["timestamp"] = datetime.now(timezone.utc).isoformat()
            self._samples.append(sample)
            self._save()
            logger.info("Added sample %s at (%.4f, %.4f)",
                        sample["sample_id"], sample.get("latitude", 0), sample.get("longitude", 0))
            return sample

    def add_batch(self, samples: List[dict]):
        """Add multiple samples at once."""
        with self._lock:
            for s in samples:
                if "sample_id" not in s:
                    s["sample_id"] = f"S{len(self._samples) + 1:03d}"
                if "timestamp" not in s:
                    s["timestamp"] = datetime.now(timezone.utc).isoformat()
                self._samples.append(s)
            self._save()
            logger.info("Added %d samples in batch", len(samples))

    def all(self) -> List[dict]:
        with self._lock:
            return list(self._samples)

    def count(self) -> int:
        with self._lock:
            return len(self._samples)

    def clear(self):
        with self._lock:
            self._samples = []
            self._save()


class WaterBodyStore:
    """Thread-safe persistent store for water body network."""

    def __init__(self):
        self._lock = threading.Lock()
        self._bodies: Dict[str, dict] = {}
        self._connections: Dict[str, List[Tuple[str, float]]] = {}
        self._load()

    def _load(self):
        if os.path.exists(WATER_BODIES_FILE):
            try:
                with open(WATER_BODIES_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._bodies = data.get("bodies", {})
                # Convert connection lists back to list of tuples
                raw_conn = data.get("connections", {})
                self._connections = {
                    k: [(c[0], c[1]) for c in v]
                    for k, v in raw_conn.items()
                }
                logger.info("Loaded %d water bodies, %d connections",
                            len(self._bodies), sum(len(v) for v in self._connections.values()) // 2)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Could not load water bodies: %s", e)
        else:
            self._bodies = {}
            self._connections = {}

    def _save(self):
        data = {
            "bodies": self._bodies,
            "connections": {k: list(v) for k, v in self._connections.items()},
        }
        with open(WATER_BODIES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def add_body(self, body_id: str, name: str, body_type: str,
                 latitude: float, longitude: float, description: str = "") -> dict:
        """Add a water body node to the network."""
        with self._lock:
            self._bodies[body_id] = {
                "name": name,
                "body_type": body_type,
                "latitude": latitude,
                "longitude": longitude,
                "description": description,
            }
            if body_id not in self._connections:
                self._connections[body_id] = []
            self._save()
            logger.info("Added water body: %s (%s) at (%.4f, %.4f)",
                        name, body_type, latitude, longitude)
            return self._bodies[body_id]

    def connect(self, body_a: str, body_b: str, distance_km: float):
        """Connect two water bodies (bidirectional)."""
        with self._lock:
            if body_a not in self._bodies or body_b not in self._bodies:
                raise ValueError(f"Both water bodies must exist: {body_a}, {body_b}")

            # Avoid duplicates
            existing_a = [c[0] for c in self._connections.get(body_a, [])]
            if body_b not in existing_a:
                self._connections.setdefault(body_a, []).append((body_b, distance_km))
            existing_b = [c[0] for c in self._connections.get(body_b, [])]
            if body_a not in existing_b:
                self._connections.setdefault(body_b, []).append((body_a, distance_km))

            self._save()
            logger.info("Connected %s <-> %s (%.1f km)", body_a, body_b, distance_km)

    def get_bodies(self) -> Dict[str, dict]:
        with self._lock:
            return dict(self._bodies)

    def get_connections(self) -> Dict[str, List[Tuple[str, float]]]:
        with self._lock:
            return {k: list(v) for k, v in self._connections.items()}

    def is_empty(self) -> bool:
        with self._lock:
            return len(self._bodies) == 0

    def clear(self):
        with self._lock:
            self._bodies = {}
            self._connections = {}
            self._save()


def preload_vrushabavathi(sample_store: SampleStore, wb_store: WaterBodyStore):
    """Load Vrushabavathi case study as initial dataset."""
    from data.vrushabavathi_case_study import (
        ALL_SAMPLING_POINTS, WATER_BODIES, WATER_BODY_CONNECTIONS,
    )

    if sample_store.count() > 0:
        logger.info("Sample store not empty, skipping preload.")
        return

    logger.info("Preloading Vrushabavathi River case study data...")

    # Load water bodies
    for wb_id, wb in WATER_BODIES.items():
        wb_store.add_body(wb_id, wb.name, wb.body_type,
                          wb.latitude, wb.longitude, wb.description)

    for wb_id, neighbors in WATER_BODY_CONNECTIONS.items():
        for neighbor_id, distance in neighbors:
            try:
                wb_store.connect(wb_id, neighbor_id, distance)
            except ValueError:
                pass

    # Load samples
    samples = []
    for sp in ALL_SAMPLING_POINTS:
        samples.append({
            "sample_id": sp.sample_id,
            "location_name": sp.location_name,
            "water_body_id": sp.water_body_id,
            "latitude": sp.latitude,
            "longitude": sp.longitude,
            "tds": sp.tds,
            "turbidity": sp.turbidity,
            "ph": sp.ph,
            "temperature": sp.temperature,
            "rgb": list(sp.rgb),
            "notes": sp.notes,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    sample_store.add_batch(samples)
    logger.info("Preloaded %d samples and %d water bodies.",
                len(samples), len(WATER_BODIES))
