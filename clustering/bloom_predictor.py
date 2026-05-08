"""
bloom_predictor.py — Algal Bloom Risk Assessment (Rule-Based)

Rules (updated with pH factor):
  HIGH     : nitrate > 25 ppm AND temperature > 30 °C
             OR nitrate > 18 ppm AND temperature > 28 °C AND pH > 8.0
  MODERATE : nitrate > 12 ppm
             OR nitrate > 8 ppm AND pH > 8.0
  LOW      : everything else

Rationale:
  Algal blooms thrive in slightly alkaline conditions (pH 7.5–9.0).
  Elevated pH amplifies bloom risk when combined with available nutrients.
"""

from __future__ import annotations


class BloomPredictor:
    """Rule-based algal bloom risk engine (considers pH)."""

    @staticmethod
    def predict(nitrate: float, temperature: float, ph: float = 7.0) -> str:
        """
        Assess algal bloom risk.

        Args:
            nitrate:     Predicted nitrate (ppm).
            temperature: Water temperature (°C).
            ph:          Water pH (0–14, default 7.0).

        Returns:
            "HIGH", "MODERATE", or "LOW".
        """
        # ── HIGH risk conditions ──────────────────────────────────────
        if nitrate > 25.0 and temperature > 30.0:
            return "HIGH"
        # pH-amplified HIGH: alkaline water accelerates bloom at lower thresholds
        if nitrate > 18.0 and temperature > 28.0 and ph > 8.0:
            return "HIGH"

        # ── MODERATE risk conditions ──────────────────────────────────
        if nitrate > 12.0:
            return "MODERATE"
        # pH-amplified MODERATE: alkaline water with moderate nutrients
        if nitrate > 8.0 and ph > 8.0:
            return "MODERATE"

        return "LOW"

