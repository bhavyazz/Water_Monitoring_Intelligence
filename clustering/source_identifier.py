"""
source_identifier.py — Rule-Based Pollution Source Attribution

Identifies probable pollution sources using water quality fingerprints
rather than external API calls. Each source type has a characteristic
signature in terms of TDS, pH, turbidity, and temperature.

Pollution source profiles (based on CPCB / literature):
    Industrial Discharge:
        High TDS (>700), acidic pH (<6.5), high turbidity (>8), variable temp
    Sewage Contamination:
        Moderate-high TDS (400-800), alkaline pH (>7.5), warm temp (>27°C)
    Agricultural Runoff:
        Low-moderate TDS (<500), neutral pH, moderate turbidity, ambient temp
    Natural/Background:
        Low TDS (<300), near-neutral pH, low turbidity

Validation: tested against known Vrushabavathi River sampling points
where ground-truth pollution sources are documented.
"""

from __future__ import annotations
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


class SourceIdentifier:
    """Rule-based pollution source identification from water quality fingerprint."""

    PROFILES = {
        "Industrial Discharge": {
            "description": "Factory effluents, chemical waste, process water",
            "indicators": {
                "tds_high": True,       # >700 ppm
                "ph_acidic": True,      # <6.5
                "turbidity_high": True, # >8 NTU
                "temp_elevated": False, # not required
            },
        },
        "Sewage Contamination": {
            "description": "Domestic wastewater, untreated sewage, organic waste",
            "indicators": {
                "tds_moderate": True,   # 400-800 ppm
                "ph_alkaline": True,    # >7.5
                "turbidity_moderate": True, # 3-10 NTU
                "temp_warm": True,      # >27°C (sewage is warmer)
            },
        },
        "Agricultural Runoff": {
            "description": "Fertilizer-laden soil runoff, irrigation return flow",
            "indicators": {
                "tds_low": True,        # <500 ppm
                "ph_neutral": True,     # 6.5-8.0
                "turbidity_moderate": True, # 2-8 NTU (soil sediment)
                "temp_ambient": True,   # <28°C
            },
        },
    }

    def identify(
        self,
        tds: float = 0.0,
        turbidity: float = 0.0,
        ph: float = 7.0,
        temperature: float = 25.0,
    ) -> str:
        """
        Determine pollution source from water quality indicators.

        Uses a scoring system: each parameter match adds points toward
        a source profile. Highest-scoring profile wins.

        Returns one of:
            "Industrial Discharge", "Sewage Contamination",
            "Agricultural Runoff", or "Natural/Background"
        """
        # Low pollution levels → no anthropogenic source
        if tds < 250 and turbidity < 1.5 and 6.5 <= ph <= 8.0:
            return "Natural/Background"

        scores = self._compute_profile_scores(tds, turbidity, ph, temperature)
        best_source = max(scores, key=scores.get)

        if scores[best_source] < 2:
            return "Natural/Background"

        logger.info(
            "Source identified: '%s' (score=%.1f) | TDS=%.0f, Turb=%.1f, pH=%.1f, T=%.1f",
            best_source, scores[best_source], tds, turbidity, ph, temperature,
        )
        return best_source

    def identify_with_details(
        self,
        tds: float = 0.0,
        turbidity: float = 0.0,
        ph: float = 7.0,
        temperature: float = 25.0,
    ) -> Dict:
        """Return source identification with scoring breakdown."""
        scores = self._compute_profile_scores(tds, turbidity, ph, temperature)
        best_source = max(scores, key=scores.get)

        if scores[best_source] < 2:
            best_source = "Natural/Background"

        reasons = self._get_reasons(tds, turbidity, ph, temperature, best_source)

        return {
            "source": best_source,
            "confidence": "HIGH" if scores.get(best_source, 0) >= 4 else
                          "MODERATE" if scores.get(best_source, 0) >= 3 else "LOW",
            "scores": {k: round(v, 1) for k, v in scores.items()},
            "reasons": reasons,
        }

    @staticmethod
    def _compute_profile_scores(
        tds: float, turbidity: float, ph: float, temperature: float,
    ) -> Dict[str, float]:
        """Score each pollution profile against observed values."""

        scores: Dict[str, float] = {}

        # ── Industrial Discharge ──────────────────────────────────────
        industrial = 0.0
        if tds > 800:
            industrial += 2.0
        elif tds > 700:
            industrial += 1.5
        if ph < 6.0:
            industrial += 2.0
        elif ph < 6.5:
            industrial += 1.5
        if turbidity > 10:
            industrial += 1.5
        elif turbidity > 8:
            industrial += 1.0
        if temperature > 30:
            industrial += 0.5
        scores["Industrial Discharge"] = industrial

        # ── Sewage Contamination ──────────────────────────────────────
        sewage = 0.0
        if 400 <= tds <= 1000:
            sewage += 1.5
        elif tds > 300:
            sewage += 0.5
        if ph > 8.0:
            sewage += 2.0
        elif ph > 7.5:
            sewage += 1.5
        if 3 <= turbidity <= 10:
            sewage += 1.0
        if temperature > 28:
            sewage += 1.5
        elif temperature > 27:
            sewage += 1.0
        scores["Sewage Contamination"] = sewage

        # ── Agricultural Runoff ───────────────────────────────────────
        agricultural = 0.0
        if tds < 400:
            agricultural += 1.5
        elif tds < 500:
            agricultural += 1.0
        if 6.5 <= ph <= 8.0:
            agricultural += 1.5
        if 2 <= turbidity <= 8:
            agricultural += 1.5
        elif turbidity < 2:
            agricultural += 0.5
        if temperature < 28:
            agricultural += 1.0
        scores["Agricultural Runoff"] = agricultural

        return scores

    @staticmethod
    def _get_reasons(
        tds: float, turbidity: float, ph: float, temperature: float, source: str,
    ) -> list:
        """Human-readable reasons for the classification."""
        reasons = []

        if source == "Industrial Discharge":
            if tds > 700:
                reasons.append(f"High TDS ({tds:.0f} ppm) indicates dissolved industrial chemicals")
            if ph < 6.5:
                reasons.append(f"Acidic pH ({ph:.1f}) suggests chemical/industrial waste")
            if turbidity > 8:
                reasons.append(f"High turbidity ({turbidity:.1f} NTU) from suspended industrial solids")

        elif source == "Sewage Contamination":
            if ph > 7.5:
                reasons.append(f"Alkaline pH ({ph:.1f}) consistent with organic decomposition")
            if 400 <= tds <= 1000:
                reasons.append(f"TDS ({tds:.0f} ppm) in typical sewage range")
            if temperature > 27:
                reasons.append(f"Elevated temperature ({temperature:.1f}°C) suggests warm sewage discharge")

        elif source == "Agricultural Runoff":
            if tds < 500:
                reasons.append(f"Moderate TDS ({tds:.0f} ppm) from dissolved soil minerals")
            if 2 <= turbidity <= 8:
                reasons.append(f"Turbidity ({turbidity:.1f} NTU) consistent with soil sediment runoff")
            if 6.5 <= ph <= 8.0:
                reasons.append(f"Near-neutral pH ({ph:.1f}) typical of agricultural drainage")

        else:
            reasons.append("Water quality within natural background levels")

        return reasons

    def identify_from_cluster(
        self,
        avg_tds: float,
        avg_turbidity: float,
        avg_ph: float,
        avg_temperature: float,
    ) -> str:
        """Identify source for a cluster using average sensor values."""
        return self.identify(avg_tds, avg_turbidity, avg_ph, avg_temperature)
