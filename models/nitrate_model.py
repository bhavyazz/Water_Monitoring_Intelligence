"""
nitrate_model.py — Nitrate Concentration Predictor

Uses a **RandomForestRegressor** trained on synthetic RGB → nitrate
data to predict nitrate concentration (ppm) from a nitrate test-strip
colour reading.

Training data generation rationale:
  • Real nitrate strips produce a colour gradient from light pink
    (low nitrate) through dark magenta/brown (high nitrate).
  • We model this with a smooth function:
      nitrate ∝  f(R, G, B)
    where higher R relative to G/B correlates with higher nitrate,
    and overall darker colours also indicate higher concentrations.
"""

from __future__ import annotations
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from typing import Tuple
import logging

logger = logging.getLogger(__name__)


class NitratePredictor:
    """
    Predicts nitrate concentration from normalised RGB values.
    The model is trained once at construction time on a synthetic
    dataset — no external data files are required.
    """

    def __init__(self, n_samples: int = 2000, seed: int = 42):
        """
        Generate synthetic training data and fit the model.

        Args:
            n_samples: Size of the synthetic training set.
            seed:      Random seed for reproducibility.
        """
        self.model = RandomForestRegressor(
            n_estimators=100,
            max_depth=12,
            random_state=seed,
        )
        self._train(n_samples, seed)
        logger.info("NitratePredictor trained on %d synthetic samples.", n_samples)

    # ── Synthetic data generation ─────────────────────────────────────

    @staticmethod
    def _generate_dataset(n: int, seed: int) -> Tuple[np.ndarray, np.ndarray]:
        """
        Create a synthetic (RGB → nitrate) dataset.

        The mapping loosely models real colorimetric test strips:
          • High R, low G, low B  → high nitrate
          • Balanced / bright RGB → low nitrate
          • Added Gaussian noise  → realistic sensor jitter

        Args:
            n:    Number of samples.
            seed: RNG seed.

        Returns:
            (X, y) where X has shape (n, 3) and y has shape (n,).
        """
        rng = np.random.RandomState(seed)

        # Normalised RGB in [0, 1]
        R = rng.uniform(0.2, 0.9, n)
        G = rng.uniform(0.15, 0.8, n)
        B = rng.uniform(0.1, 0.7, n)

        # Nitrate formula (ppm):
        #   Base contribution from redness dominance
        #   + penalty for brightness (very bright = dilute strip)
        #   + small non-linear interaction term
        nitrate = (
            40.0 * R                       # Red channel drives nitrate up
            - 25.0 * G                     # Green dampens it
            - 15.0 * B                     # Blue dampens it
            + 10.0 * (R - G) ** 2          # Non-linear colour-gap term
            + 5.0 * np.sin(R * np.pi)      # Slight curvature
            + rng.normal(0, 1.5, n)        # Sensor noise
        )

        # Clamp to realistic range [0, 50] ppm
        nitrate = np.clip(nitrate, 0.0, 50.0)

        X = np.column_stack([R, G, B])
        return X, nitrate

    def _train(self, n_samples: int, seed: int) -> None:
        """Fit the model on synthetic data."""
        X, y = self._generate_dataset(n_samples, seed)
        self.model.fit(X, y)

    # ── Inference ─────────────────────────────────────────────────────

    def predict(self, rgb_normalized: Tuple[float, float, float]) -> float:
        """
        Predict nitrate concentration from a single normalised RGB tuple.

        Args:
            rgb_normalized: (R, G, B) each in [0, 1].

        Returns:
            Predicted nitrate concentration in ppm (≥ 0).
        """
        X = np.array(rgb_normalized).reshape(1, -1)
        prediction = float(self.model.predict(X)[0])
        return round(max(prediction, 0.0), 2)


# ── Standalone demo ───────────────────────────────────────────────────
if __name__ == "__main__":
    model = NitratePredictor()
    test_cases = [
        (0.47, 0.38, 0.30),  # moderate
        (0.85, 0.20, 0.15),  # high
        (0.30, 0.70, 0.60),  # low
    ]
    for rgb in test_cases:
        ppm = model.predict(rgb)
        print(f"RGB {rgb} → Nitrate: {ppm:.2f} ppm")
