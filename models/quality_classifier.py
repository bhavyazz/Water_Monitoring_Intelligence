"""
quality_classifier.py — Water Quality Classification

RandomForestClassifier: (TDS, Turbidity, Nitrate, Temperature) → Safe/Moderate/Unsafe
"""

from __future__ import annotations
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from typing import Tuple
import logging

logger = logging.getLogger(__name__)
LABELS = ["Safe", "Moderate", "Unsafe"]


class WaterQualityClassifier:
    def __init__(self, n_samples: int = 3000, seed: int = 42):
        self.model = RandomForestClassifier(n_estimators=120, max_depth=10, random_state=seed)
        self._train(n_samples, seed)
        logger.info("WaterQualityClassifier trained on %d samples.", n_samples)

    @staticmethod
    def _generate_dataset(n: int, seed: int) -> Tuple[np.ndarray, np.ndarray]:
        rng = np.random.RandomState(seed)
        tds = rng.uniform(200, 1000, n)
        turb = rng.uniform(1.0, 5.0, n)
        nitr = rng.uniform(0, 50, n)
        temp = rng.uniform(20, 35, n)
        labels = np.zeros(n, dtype=int)
        labels[(tds > 450) | (turb > 2.5) | (nitr > 15)] = 1
        labels[(tds > 700) | (turb > 3.5) | (nitr > 30)] = 2
        return np.column_stack([tds, turb, nitr, temp]), labels

    def _train(self, n_samples: int, seed: int) -> None:
        X, y = self._generate_dataset(n_samples, seed)
        self.model.fit(X, y)

    def classify(self, tds: float, turbidity: float, nitrate: float, temperature: float) -> str:
        """Classify water quality → Safe / Moderate / Unsafe."""
        X = np.array([[tds, turbidity, nitrate, temperature]])
        return LABELS[int(self.model.predict(X)[0])]
