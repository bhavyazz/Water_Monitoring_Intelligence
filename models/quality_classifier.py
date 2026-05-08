"""
quality_classifier.py — Water Quality Classification

RandomForestClassifier: (TDS, Turbidity, Nitrate, Temperature, pH) → Safe/Moderate/Unsafe

pH thresholds (WHO/EPA guidelines):
  Safe water pH:   6.5 – 8.5
  Moderate risk:   6.0 – 6.5  or  8.5 – 9.0
  Unsafe:          < 6.0  or  > 9.0
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
        logger.info("WaterQualityClassifier trained on %d samples (5 features incl. pH).", n_samples)

    @staticmethod
    def _generate_dataset(n: int, seed: int) -> Tuple[np.ndarray, np.ndarray]:
        rng = np.random.RandomState(seed)
        tds = rng.uniform(200, 1000, n)
        turb = rng.uniform(1.0, 5.0, n)
        nitr = rng.uniform(0, 50, n)
        temp = rng.uniform(20, 35, n)
        ph = rng.uniform(4.0, 11.0, n)

        labels = np.zeros(n, dtype=int)

        # Moderate conditions
        labels[
            (tds > 450) | (turb > 2.5) | (nitr > 15) |
            (ph < 6.5) | (ph > 8.5)
        ] = 1

        # Unsafe conditions (override moderate)
        labels[
            (tds > 700) | (turb > 3.5) | (nitr > 30) |
            (ph < 6.0) | (ph > 9.0)
        ] = 2

        return np.column_stack([tds, turb, nitr, temp, ph]), labels

    def _train(self, n_samples: int, seed: int) -> None:
        X, y = self._generate_dataset(n_samples, seed)
        self.model.fit(X, y)

    def classify(self, tds: float, turbidity: float, nitrate: float, temperature: float, ph: float = 7.0) -> str:
        """Classify water quality → Safe / Moderate / Unsafe.

        Args:
            tds:         Total dissolved solids (ppm).
            turbidity:   Turbidity (NTU).
            nitrate:     Nitrate concentration (ppm).
            temperature: Water temperature (°C).
            ph:          pH value (0–14, default 7.0 = neutral).
        """
        X = np.array([[tds, turbidity, nitrate, temperature, ph]])
        return LABELS[int(self.model.predict(X)[0])]
