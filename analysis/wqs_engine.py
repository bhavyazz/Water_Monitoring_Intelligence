"""
wqs_engine.py — Water Quality Score Engine (BIS 10500:2012)

Computes a normalized composite score [0,1] where 0=pristine, 1=severely polluted.
Uses the weighted normalized exceedance method: each parameter's exceedance
above the BIS 10500 'acceptable' limit is normalized to [0,1] against the
permissible limit, then combined via literature-derived importance weights.

Reference standards:
    BIS 10500:2012 — Indian Standard for Drinking Water
    WHO Guidelines for Drinking-Water Quality (4th ed.)
"""

from __future__ import annotations
from typing import Dict, List


class WQSEngine:

    BIS_10500 = {
        "tds":         {"acceptable": 500,  "permissible": 2000, "weight": 0.30},
        "turbidity":   {"acceptable": 1,    "permissible": 5,    "weight": 0.25},
        "ph_low":      {"threshold": 6.5,   "weight": 0.15},
        "ph_high":     {"threshold": 8.5,   "weight": 0.15},
        "temperature": {"acceptable": 35,   "permissible": 45,   "weight": 0.15},
    }

    USE_THRESHOLDS = {
        "drinking": {"tds": 500,  "turbidity": 1,  "ph_low": 6.5, "ph_high": 8.5, "temp": 35},
        "irrigation": {"tds": 2100, "turbidity": 50, "ph_low": 6.0, "ph_high": 9.0, "temp": 45},
        "bathing":    {"tds": 1500, "turbidity": 10, "ph_low": 6.5, "ph_high": 8.5, "temp": 37},
    }

    @staticmethod
    def _exceedance_tds(tds: float) -> float:
        if tds <= 500:
            return 0.0
        return min(1.0, (tds - 500) / 1500)

    @staticmethod
    def _exceedance_turbidity(turb: float) -> float:
        if turb <= 1:
            return 0.0
        return min(1.0, (turb - 1) / 4)

    @staticmethod
    def _exceedance_ph(ph: float) -> float:
        low = max(0.0, (6.5 - ph) / 2.0)
        high = max(0.0, (ph - 8.5) / 2.0)
        return min(1.0, max(low, high))

    @staticmethod
    def _exceedance_temperature(temp: float) -> float:
        if temp <= 35:
            return 0.0
        return min(1.0, (temp - 35) / 10)

    @classmethod
    def classify_score(cls, wqs: float) -> str:
        if wqs < 0.15:
            return "CLEAN"
        if wqs < 0.40:
            return "MODERATE"
        if wqs < 0.65:
            return "POLLUTED"
        return "SEVERELY_POLLUTED"

    def compute(
        self,
        tds: float = 0.0,
        turbidity: float = 0.0,
        ph: float = 7.0,
        temperature: float = 25.0,
    ) -> Dict:
        e_tds = self._exceedance_tds(tds)
        e_turb = self._exceedance_turbidity(turbidity)
        e_ph = self._exceedance_ph(ph)
        e_temp = self._exceedance_temperature(temperature)

        parameter_scores = {
            "tds": round(e_tds, 4),
            "turbidity": round(e_turb, 4),
            "ph": round(e_ph, 4),
            "temperature": round(e_temp, 4),
        }

        wqs = (
            0.30 * e_tds
            + 0.25 * e_turb
            + 0.30 * e_ph
            + 0.15 * e_temp
        )
        wqs = round(min(1.0, wqs), 4)

        classification = self.classify_score(wqs)

        scores_list = [
            ("tds", e_tds),
            ("turbidity", e_turb),
            ("ph", e_ph),
            ("temperature", e_temp),
        ]
        limiting = max(scores_list, key=lambda x: x[1])

        exceedances = {}
        if tds > 500:
            exceedances["tds"] = f"{tds:.0f} ppm exceeds BIS acceptable limit (500 ppm)"
        if turbidity > 1:
            exceedances["turbidity"] = f"{turbidity:.1f} NTU exceeds BIS acceptable limit (1 NTU)"
        if ph < 6.5:
            exceedances["ph"] = f"pH {ph:.1f} below BIS acceptable range (6.5)"
        elif ph > 8.5:
            exceedances["ph"] = f"pH {ph:.1f} above BIS acceptable range (8.5)"
        if temperature > 35:
            exceedances["temperature"] = f"{temperature:.1f}°C exceeds BIS acceptable limit (35°C)"

        safe_drinking = self._check_use("drinking", tds, turbidity, ph, temperature)
        safe_irrigation = self._check_use("irrigation", tds, turbidity, ph, temperature)
        safe_bathing = self._check_use("bathing", tds, turbidity, ph, temperature)

        return {
            "wqs": wqs,
            "classification": classification,
            "parameter_scores": parameter_scores,
            "limiting_parameter": limiting[0] if limiting[1] > 0 else "none",
            "exceedances_vs_bis": exceedances,
            "safe_for_drinking": safe_drinking,
            "safe_for_irrigation": safe_irrigation,
            "safe_for_bathing": safe_bathing,
            "methodology_note": (
                "Weighted normalized exceedance against BIS 10500:2012 drinking water standards. "
                "Parameters: TDS (w=0.30), turbidity (w=0.25), pH (w=0.30), temperature (w=0.15). "
                "Score range [0,1]: 0=pristine, 1=severely polluted. "
                "Limitations: 4-parameter subset covers ~15% of BIS parameters. "
                "Unmeasured risks include: DO, BOD, fecal coliform, heavy metals, pesticides."
            ),
        }

    def _check_use(self, use: str, tds: float, turb: float, ph: float, temp: float) -> Dict:
        th = self.USE_THRESHOLDS[use]
        violations: List[str] = []
        if tds > th["tds"]:
            violations.append(f"TDS {tds:.0f} > {th['tds']}")
        if turb > th["turbidity"]:
            violations.append(f"Turbidity {turb:.1f} > {th['turbidity']}")
        if ph < th["ph_low"]:
            violations.append(f"pH {ph:.1f} < {th['ph_low']}")
        if ph > th["ph_high"]:
            violations.append(f"pH {ph:.1f} > {th['ph_high']}")
        if temp > th["temp"]:
            violations.append(f"Temp {temp:.1f} > {th['temp']}")
        return {"safe": len(violations) == 0, "violations": violations}

    def score(self, tds=0.0, turbidity=0.0, ph=7.0, temperature=25.0) -> float:
        return self.compute(tds, turbidity, ph, temperature)["wqs"]
