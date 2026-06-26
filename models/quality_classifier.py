"""
quality_classifier.py -- Water Quality Classification (Trained on Real Dataset)

Uses RandomForest trained on Kaggle Water Potability dataset (2785 samples)
with BIS 10500:2012 labels.

Features: pH, TDS (ppm), Turbidity (NTU)
Output:   Safe / Moderate / Unsafe

Model file: models/water_quality_model.joblib
Train with: python -m models.train_quality_model
"""

from __future__ import annotations
import os
import logging
import numpy as np

logger = logging.getLogger(__name__)
LABELS = ["Safe", "Moderate", "Unsafe"]

MODEL_PATH = os.path.join(os.path.dirname(__file__), "water_quality_model.joblib")


class WaterQualityClassifier:
    def __init__(self):
        import joblib

        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Trained model not found at {MODEL_PATH}. "
                "Run: python -m models.train_quality_model"
            )

        self.model = joblib.load(MODEL_PATH)
        logger.info("WaterQualityClassifier loaded from %s", MODEL_PATH)

    def classify(self, tds: float, turbidity: float, ph: float = 7.0, **_kwargs) -> str:
        """Classify water quality -> Safe / Moderate / Unsafe.

        Args:
            ph:        pH value (0-14).
            tds:       Total dissolved solids (ppm).
            turbidity: Turbidity (NTU).
        """
        X = np.array([[ph, tds, turbidity]])
        return LABELS[int(self.model.predict(X)[0])]

    def classify_with_proba(self, tds: float, turbidity: float, ph: float = 7.0, **_kwargs) -> dict:
        """Classify with confidence probabilities."""
        X = np.array([[ph, tds, turbidity]])
        pred = int(self.model.predict(X)[0])
        proba = self.model.predict_proba(X)[0]

        return {
            "label": LABELS[pred],
            "confidence": float(max(proba)),
            "probabilities": {LABELS[i]: round(float(p), 3) for i, p in enumerate(proba)},
        }
