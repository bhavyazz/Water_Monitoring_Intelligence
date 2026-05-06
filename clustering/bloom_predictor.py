"""
bloom_predictor.py — Algal Bloom Risk Assessment (Rule-Based)

Rules:
  HIGH     : nitrate > 25 ppm AND temperature > 30 °C
  MODERATE : nitrate > 12 ppm
  LOW      : everything else
"""

from __future__ import annotations


class BloomPredictor:
    """Rule-based algal bloom risk engine."""

    @staticmethod
    def predict(nitrate: float, temperature: float) -> str:
        """
        Assess algal bloom risk.

        Args:
            nitrate:     Predicted nitrate (ppm).
            temperature: Water temperature (°C).

        Returns:
            "HIGH", "MODERATE", or "LOW".
        """
        if nitrate > 25.0 and temperature > 30.0:
            return "HIGH"
        if nitrate > 12.0:
            return "MODERATE"
        return "LOW"
