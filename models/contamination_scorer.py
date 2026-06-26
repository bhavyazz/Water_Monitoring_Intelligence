"""
contamination_scorer.py — Water Quality Index (WQI) Based Contamination Assessment

Computes a contamination score (0-100) using the Weighted Arithmetic
Water Quality Index method, validated against BIS 10500:2012 and WHO
drinking water guidelines.

Parameters and standards:
    pH:          BIS desirable 6.5-8.5, permissible 6.0-9.0
    TDS:         BIS desirable ≤500 ppm, permissible ≤2000 ppm
    Turbidity:   BIS desirable ≤1 NTU, permissible ≤5 NTU
    Temperature: Deviation from 25°C ambient baseline

Classification:
    0-25   Excellent  (Safe)
    26-50  Good       (Safe)
    51-75  Poor       (Moderate)
    76-100 Critical   (Unsafe)
"""

from __future__ import annotations
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


class ContaminationScorer:
    """WQI-based contamination scoring using BIS 10500:2012 / WHO standards."""

    # Weights sum to 1.0
    WEIGHTS = {
        "ph": 0.30,
        "tds": 0.25,
        "turbidity": 0.25,
        "temperature": 0.20,
    }

    @staticmethod
    def _sub_index_ph(ph: float) -> float:
        """
        Sub-index for pH. Ideal = 7.0.
        BIS desirable: 6.5-8.5, permissible: 6.0-9.0.
        Deviation in either direction increases score.
        """
        deviation = abs(ph - 7.0)
        if deviation <= 1.5:
            return (deviation / 1.5) * 50.0
        elif deviation <= 3.0:
            return 50.0 + ((deviation - 1.5) / 1.5) * 50.0
        return 100.0

    @staticmethod
    def _sub_index_tds(tds: float) -> float:
        """
        Sub-index for TDS (ppm).
        BIS desirable: ≤500, permissible: ≤2000.
        """
        if tds <= 500:
            return (tds / 500.0) * 50.0
        elif tds <= 2000:
            return 50.0 + ((tds - 500.0) / 1500.0) * 50.0
        return 100.0

    @staticmethod
    def _sub_index_turbidity(turbidity: float) -> float:
        """
        Sub-index for Turbidity (NTU).
        BIS desirable: ≤1, permissible: ≤5.
        """
        if turbidity <= 1.0:
            return (turbidity / 1.0) * 25.0
        elif turbidity <= 5.0:
            return 25.0 + ((turbidity - 1.0) / 4.0) * 50.0
        return min(75.0 + ((turbidity - 5.0) / 10.0) * 25.0, 100.0)

    @staticmethod
    def _sub_index_temperature(temperature: float) -> float:
        """
        Sub-index for temperature deviation from 25°C ambient.
        No BIS standard for temp, but deviation indicates thermal pollution.
        """
        deviation = abs(temperature - 25.0)
        return min((deviation / 15.0) * 100.0, 100.0)

    def compute(
        self,
        ph: float = 7.0,
        tds: float = 0.0,
        turbidity: float = 0.0,
        temperature: float = 25.0,
    ) -> Dict:
        """
        Compute WQI contamination score.

        Returns:
            dict with keys: score, label, quality_label, sub_indices
        """
        sub_indices = {
            "ph": round(self._sub_index_ph(ph), 2),
            "tds": round(self._sub_index_tds(tds), 2),
            "turbidity": round(self._sub_index_turbidity(turbidity), 2),
            "temperature": round(self._sub_index_temperature(temperature), 2),
        }

        score = sum(
            sub_indices[param] * self.WEIGHTS[param]
            for param in self.WEIGHTS
        )
        score = round(min(score, 100.0), 2)

        if score <= 25:
            label = "Excellent"
            quality_label = "Safe"
        elif score <= 50:
            label = "Good"
            quality_label = "Safe"
        elif score <= 75:
            label = "Poor"
            quality_label = "Moderate"
        else:
            label = "Critical"
            quality_label = "Unsafe"

        return {
            "score": score,
            "label": label,
            "quality_label": quality_label,
            "sub_indices": sub_indices,
        }

    def score(
        self,
        ph: float = 7.0,
        tds: float = 0.0,
        turbidity: float = 0.0,
        temperature: float = 25.0,
    ) -> float:
        """Return just the numeric contamination score (0-100)."""
        return self.compute(ph, tds, turbidity, temperature)["score"]

    def classify(
        self,
        tds: float,
        turbidity: float,
        temperature: float,
        ph: float = 7.0,
    ) -> str:
        """
        Backward-compatible classifier interface.
        Returns: "Safe", "Moderate", or "Unsafe".
        """
        return self.compute(ph, tds, turbidity, temperature)["quality_label"]


if __name__ == "__main__":
    scorer = ContaminationScorer()

    test_cases = [
        ("Clean water",       7.0,  150,  0.5, 25.0),
        ("Moderate pollution", 8.0,  550,  3.0, 28.0),
        ("Industrial waste",  5.8, 1050, 12.0, 30.5),
        ("Sewage water",      8.2,  680,  6.5, 29.0),
        ("Agricultural",      7.3,  420,  3.8, 27.0),
    ]
    print(f"{'Description':<22} {'pH':>5} {'TDS':>6} {'Turb':>5} {'Temp':>5}  {'Score':>6} {'Label':<10} {'Quality'}")
    print("-" * 85)
    for desc, ph, tds, turb, temp in test_cases:
        result = scorer.compute(ph, tds, turb, temp)
        print(f"{desc:<22} {ph:>5.1f} {tds:>6.0f} {turb:>5.1f} {temp:>5.1f}  "
              f"{result['score']:>6.2f} {result['label']:<10} {result['quality_label']}")
