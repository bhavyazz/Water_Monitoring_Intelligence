"""
ph_model.py — pH Prediction from Colorimetric Biosensor

Uses a **RandomForestRegressor** trained on synthetic RGB → pH
data to predict pH from a paper-based colorimetric biosensor strip.

Training data generation rationale:
  • Universal pH indicator strips produce a colour gradient:
      Red/Orange  →  Acidic  (pH 1–4)
      Yellow/Green →  Neutral (pH 5–7)
      Blue/Purple  →  Basic   (pH 8–14)
  • We model this with a smooth function:
      pH ∝ f(R, G, B)
    where higher B relative to R correlates with higher (basic) pH,
    and higher R relative to B correlates with lower (acidic) pH.
"""

from __future__ import annotations
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from typing import Tuple
import logging

logger = logging.getLogger(__name__)


class pHPredictor:
    """
    Predicts pH from normalised RGB values.
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
        logger.info("pHPredictor trained on %d synthetic samples.", n_samples)

    # ── Synthetic data generation ─────────────────────────────────────

    @staticmethod
    def _generate_dataset(n: int, seed: int) -> Tuple[np.ndarray, np.ndarray]:
        """
        Create a synthetic (RGB → pH) dataset.

        The mapping models universal pH indicator strips:
          • High R, low B         → acidic  (low pH)
          • Balanced G            → neutral (mid pH)
          • High B, low R         → basic   (high pH)
          • Added Gaussian noise  → realistic sensor jitter

        Args:
            n:    Number of samples.
            seed: RNG seed.

        Returns:
            (X, y) where X has shape (n, 3) and y has shape (n,).
        """
        rng = np.random.RandomState(seed)

        # Normalised RGB in [0, 1]
        R = rng.uniform(0.1, 0.9, n)
        G = rng.uniform(0.1, 0.85, n)
        B = rng.uniform(0.1, 0.9, n)

        # pH formula:
        #   Blue dominance pushes pH up (basic)
        #   Red dominance pushes pH down (acidic)
        #   Green contributes to neutral region
        ph = (
            7.0                            # Neutral baseline
            + 4.0 * (B - R)               # Blue–Red difference drives pH
            + 1.5 * (G - 0.5)             # Green nudges toward neutral
            - 2.0 * (R - G) ** 2          # Non-linear acid-shift
            + 0.8 * np.sin(B * np.pi)     # Slight curvature
            + rng.normal(0, 0.4, n)       # Sensor noise
        )

        # Clamp to realistic pH range [0, 14]
        ph = np.clip(ph, 0.0, 14.0)

        X = np.column_stack([R, G, B])
        return X, ph

    def _train(self, n_samples: int, seed: int) -> None:
        """Fit the model on synthetic data."""
        X, y = self._generate_dataset(n_samples, seed)
        self.model.fit(X, y)

    # ── Inference ─────────────────────────────────────────────────────

    def predict(self, rgb_normalized: Tuple[float, float, float]) -> float:
        """
        Predict pH from a single normalised RGB tuple.

        Args:
            rgb_normalized: (R, G, B) each in [0, 1].

        Returns:
            Predicted pH value (0–14).
        """
        X = np.array(rgb_normalized).reshape(1, -1)
        prediction = float(self.model.predict(X)[0])
        return round(max(0.0, min(14.0, prediction)), 2)


# ── Standalone demo ───────────────────────────────────────────────────
if __name__ == "__main__":
    model = pHPredictor()
    test_cases = [
        (0.85, 0.20, 0.10),  # acidic (high R, low B)
        (0.40, 0.60, 0.40),  # neutral (balanced)
        (0.15, 0.25, 0.85),  # basic (high B, low R)
    ]
    for rgb in test_cases:
        val = model.predict(rgb)
        print(f"RGB {rgb} → pH: {val:.2f}")
