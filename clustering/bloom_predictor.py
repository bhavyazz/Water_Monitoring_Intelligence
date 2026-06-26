"""
bloom_predictor.py — Algal Bloom Risk Indicator (Rule-Based)

Simplified bloom risk assessment using available sensor parameters.
Uses pH + temperature + turbidity (no nitrate/phosphate/chlorophyll
required, which are unavailable from basic IoT sensors).

Rationale:
    - Algal blooms thrive in warm (>28°C), alkaline (pH >8.0) water
    - Low turbidity + high temp + alkaline pH = ideal bloom conditions
    - High turbidity inhibits photosynthesis → lowers bloom risk
    - This is a risk INDICATOR, not a prediction model

Risk levels:
    HIGH:     pH > 8.5 AND temp > 30°C AND turbidity < 3
              OR pH > 8.0 AND temp > 28°C AND turbidity < 2
    MODERATE: pH > 7.8 AND temp > 27°C AND turbidity < 5
              OR pH > 8.0 AND temp > 25°C
    LOW:      everything else
"""

from __future__ import annotations


class BloomPredictor:
    """Rule-based algal bloom risk indicator."""

    @staticmethod
    def predict(
        temperature: float,
        ph: float = 7.0,
        turbidity: float = 5.0,
    ) -> str:
        """
        Assess algal bloom risk from available sensor data.

        Args:
            temperature: Water temperature (°C).
            ph:          Water pH (0-14, default 7.0).
            turbidity:   Water turbidity (NTU, default 5.0).

        Returns:
            "HIGH", "MODERATE", or "LOW".
        """
        # ── HIGH risk: warm + alkaline + clear water ──────────────────
        if ph > 8.5 and temperature > 30.0 and turbidity < 3.0:
            return "HIGH"
        if ph > 8.0 and temperature > 28.0 and turbidity < 2.0:
            return "HIGH"

        # ── MODERATE risk ─────────────────────────────────────────────
        if ph > 7.8 and temperature > 27.0 and turbidity < 5.0:
            return "MODERATE"
        if ph > 8.0 and temperature > 25.0:
            return "MODERATE"

        return "LOW"
