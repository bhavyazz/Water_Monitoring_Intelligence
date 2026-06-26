"""
dataset.py — Collected Sample Dataset Loader

Loads validation samples from data/collected_samples.json.
Each sample is a GPS-tagged water quality reading from the
Vrishabhavathy river validation study.
"""

from __future__ import annotations
import json
import os
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class CollectedSample:
    id: str
    label: str
    lat: float
    lon: float
    timestamp: str
    tds: float
    turbidity: float
    temperature: float
    ph: float
    source_type: str
    notes: str


class SampleDataset:
    """Loads and serves the collected sample dataset."""

    _DATA_PATH = os.path.join(os.path.dirname(__file__), "collected_samples.json")

    def __init__(self, path: str = None):
        self._path = path or self._DATA_PATH
        self._samples: List[CollectedSample] = []
        self._load()

    def _load(self):
        with open(self._path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        self._samples = [
            CollectedSample(
                id=s["id"],
                label=s["label"],
                lat=s["lat"],
                lon=s["lon"],
                timestamp=s["timestamp"],
                tds=s["tds"],
                turbidity=s["turbidity"],
                temperature=s["temperature"],
                ph=s["ph"],
                source_type=s["source_type"],
                notes=s["notes"],
            )
            for s in raw
        ]

    def all(self) -> List[CollectedSample]:
        return list(self._samples)

    def get(self, sample_id: str) -> Optional[CollectedSample]:
        for s in self._samples:
            if s.id == sample_id:
                return s
        return None

    def count(self) -> int:
        return len(self._samples)

    def to_dicts(self) -> List[dict]:
        return [
            {
                "id": s.id,
                "label": s.label,
                "lat": s.lat,
                "lon": s.lon,
                "timestamp": s.timestamp,
                "tds": s.tds,
                "turbidity": s.turbidity,
                "temperature": s.temperature,
                "ph": s.ph,
                "source_type": s.source_type,
                "notes": s.notes,
            }
            for s in self._samples
        ]
