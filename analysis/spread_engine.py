"""
spread_engine.py — Downstream Contaminant Spread Estimation

Uses the simplified 1D Advection-Dispersion Equation (ADE):
  C(x,t) = (C0/sqrt(4πDt)) * exp(-(x-vt)²/(4Dt)) * exp(-kt)

For stagnant water bodies: 2D radial diffusion model.

Default parameters are derived from published sources, not assumed:

  v = 0.4 m/s
    Vrishabhavathi carries ~576 MLD sewage (BWSSB/NGT, 2023) = 6.67 m³/s.
    Estimated channel W≈10m, H≈1m → v = Q/A ≈ 0.67 m/s at midstream.
    Upstream (near RVCE, less input) ~0.3-0.5 m/s. Use 0.4 m/s.
    Cross-validated: Yamuna River Delhi non-monsoon measured ≈ 0.4 m/s
    (Hydrodynamic simulation of urban stormwater drain, Delhi, 2023).

  D = 5.0 m²/s
    Fischer et al. (1975): D = 0.011 × U² × W² / (H × u*)
    Vrishabhavathi slope S = 278m / 69km = 0.004 (elevation profile data).
    Shear velocity u* = sqrt(g × H × S) = sqrt(9.81 × 1.0 × 0.004) = 0.20 m/s.
    Fischer D = 0.011 × 0.4² × 10² / (1.0 × 0.20) = 0.88 m²/s.
    Fischer formula underestimates by 5-10× in irregular urban channels
    (Kashefipour & Falconer, 2002; Deng et al., 2001). Apply 5× → 4.4 m²/s.
    Use D = 5.0 m²/s (rounded, conservative upper bound for small urban river).

  k = 2.7e-6 /s (= 0.23 /day)
    Standard first-order BOD decay rate for domestic sewage at 20°C.
    Source: Metcalf & Eddy (2003), Wastewater Engineering, Table 3-16.
    Also consistent with IIT Delhi CVL212 published problem sets (k₁ = 0.23/day).
    At travel distances <2km (t < 83 min at 0.4 m/s), decay effect is minimal
    (exp(-kt) ≈ 0.987), so this is included for correctness not impact.

References:
  Fischer, H.B. et al. (1979) Mixing in Inland and Coastal Waters. Academic Press.
  Kashefipour, S.M. & Falconer, R.A. (2002) J. Hydraul. Eng. 128(2):159-168.
  Metcalf & Eddy (2003) Wastewater Engineering, 4th ed., McGraw-Hill.
  BWSSB/NGT (2023) Restoration of Vrushabhavathi River, Case No. 18520.
"""

from __future__ import annotations
import logging
import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

DISTANCE_MARKERS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000]

# Overpass blocks the default python-requests User-Agent with HTTP 406.
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_HEADERS = {
    "User-Agent": "AquaVision/1.0 (water-quality-monitoring; RVCE Bangalore)"
}

HYDRO_DEFAULTS = {
    "v": 0.4,
    "v_source": (
        "Estimated from Vrishabhavathi discharge 576 MLD / channel cross-section ~10 m²; "
        "cross-validated against Yamuna River Delhi non-monsoon measurement (0.4 m/s)"
    ),
    "D": 5.0,
    "D_source": (
        "Fischer (1975) formula D = 0.011·U²·W²/(H·u*) with W=10m, H=1m, S=0.004 "
        "gives 0.88 m²/s; ×5 correction for irregular urban channel geometry "
        "(Kashefipour & Falconer 2002)"
    ),
    "k": 2.7e-6,
    "k_source": (
        "First-order BOD decay 0.23/day at 20°C for domestic sewage "
        "(Metcalf & Eddy 2003, Table 3-16)"
    ),
}


class SpreadEstimator:

    def __init__(self, wqs_engine=None):
        self.wqs_engine = wqs_engine

    def find_water_body(self, lat: float, lon: float) -> Dict[str, Any]:
        """Query OSM for nearest waterway to reading coordinates (cached)."""
        from analysis.osm_client import overpass_post, cache_get, cache_put

        cache_key = f"wb:{round(lat, 4)},{round(lon, 4)}"
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

        on_query = (
            f"[out:json][timeout:10];\n"
            f"(\n"
            f'  way["waterway"~"river|stream|canal|drain"](around:50,{lat},{lon});\n'
            f'  way["natural"="water"](around:100,{lat},{lon});\n'
            f'  relation["natural"="water"](around:100,{lat},{lon});\n'
            f");\n"
            f"out geom;"
        )

        near_query = (
            f"[out:json][timeout:10];\n"
            f'way["waterway"~"river|stream|canal|drain"](around:1500,{lat},{lon});\n'
            f"out geom;"
        )

        try:
            data = overpass_post(on_query, timeout=12)
            elements = data.get("elements", [])

            if elements:
                el = elements[0]
                name = el.get("tags", {}).get("name", "unnamed waterway")
                geom = self._extract_geometry(el)
                dist = self._min_dist_to_geom(lat, lon, geom)
                result = {
                    "type": "on_waterway",
                    "name": name,
                    "waterway_type": el.get("tags", {}).get("waterway", "water"),
                    "geometry": geom,
                    "distance_m": round(dist, 1),
                }
                cache_put(cache_key, result)
                return result

            data2 = overpass_post(near_query, timeout=12)
            elements2 = data2.get("elements", [])

            if elements2:
                best = None
                best_dist = float("inf")
                best_geom = []
                for el in elements2:
                    geom = self._extract_geometry(el)
                    d = self._min_dist_to_geom(lat, lon, geom)
                    if d < best_dist:
                        best_dist = d
                        best = el
                        best_geom = geom

                if best:
                    name = best.get("tags", {}).get("name", "unnamed waterway")
                    result = {
                        "type": "nearest_waterway",
                        "name": name,
                        "waterway_type": best.get("tags", {}).get("waterway", "river"),
                        "geometry": best_geom,
                        "distance_m": round(best_dist, 1),
                    }
                    cache_put(cache_key, result)
                    return result

        except Exception as e:
            logger.warning("Water body lookup failed: %s", e)
            # Don't cache failures — allow a later retry to succeed.
            return {
                "type": "not_found",
                "user_input_required": True,
                "message": "Overpass lookup failed (rate-limited or offline). Retry or identify manually.",
            }

        return {
            "type": "not_found",
            "user_input_required": True,
            "message": "No waterway found within 1.5km. Provide water body details manually.",
        }

    def estimate_spread(
        self,
        wqs: float,
        lat: float,
        lon: float,
        v: float = None,
        D: float = None,
        k: float = None,
        water_body: Optional[Dict] = None,
        water_body_override: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Estimate downstream contaminant spread from a polluted reading.

        Args:
            wqs: Water quality score at source [0,1]
            lat, lon: Source coordinates
            v: Flow velocity m/s (default from HYDRO_DEFAULTS)
            D: Longitudinal dispersion coefficient m²/s (default from HYDRO_DEFAULTS)
            k: First-order decay rate 1/s (default from HYDRO_DEFAULTS)
            water_body: Result from find_water_body()
            water_body_override: User-provided {type, flow_velocity_ms, area_m2}
        """
        if v is None:
            v = HYDRO_DEFAULTS["v"]
        if D is None:
            D = HYDRO_DEFAULTS["D"]
        if k is None:
            k = HYDRO_DEFAULTS["k"]

        if wqs < 0.15:
            return {
                "spread_needed": False,
                "reasoning": "Source WQS below threshold (0.15) — no significant contamination to model.",
            }

        is_stagnant = False
        actual_v = v

        if water_body_override:
            wb_type = water_body_override.get("type", "river")
            if wb_type in ("pond", "lake", "reservoir"):
                is_stagnant = True
            if "flow_velocity_ms" in water_body_override:
                actual_v = water_body_override["flow_velocity_ms"]
                if actual_v == 0:
                    is_stagnant = True

        if is_stagnant:
            return self._stagnant_spread(wqs, D)

        downstream_coords = []
        if water_body and water_body.get("geometry"):
            downstream_coords = self._extract_downstream_path(
                lat, lon, water_body["geometry"]
            )

        predictions = self._ade_predict(wqs, DISTANCE_MARKERS, actual_v, D, k)

        for pred in predictions:
            coord = self._interpolate_coord(
                lat, lon, pred["distance_m"], downstream_coords
            )
            if coord:
                pred["downstream_lat"] = coord[0]
                pred["downstream_lon"] = coord[1]

        safe_distance = None
        for pred in predictions:
            if pred["predicted_wqs"] < 0.15:
                safe_distance = pred["distance_m"]
                break

        wb_name = "unknown"
        if water_body and water_body.get("name"):
            wb_name = water_body["name"]

        return {
            "spread_needed": True,
            "water_body": wb_name,
            "water_body_type": water_body.get("type", "not_found") if water_body else "not_found",
            "source_wqs": round(wqs, 4),
            "flow_velocity_ms": actual_v,
            "dispersion_coefficient": D,
            "decay_rate": k,
            "predictions": predictions,
            "safe_distance_m": safe_distance,
            "downstream_path": downstream_coords[:20] if downstream_coords else [],
            "assumptions": (
                f"v={actual_v} m/s — {HYDRO_DEFAULTS['v_source']}. "
                f"D={D} m²/s — {HYDRO_DEFAULTS['D_source']}. "
                f"k={k:.2e} /s ({k * 86400:.2f}/day) — {HYDRO_DEFAULTS['k_source']}. "
                "Steady-state point source assumed. "
                "Actual spread depends on real-time flow, channel geometry, and mixing regime."
            ),
            "methodology_note": (
                "1D Advection-Dispersion Equation (Fischer et al. 1979). "
                "Parameters derived from Vrishabhavathi discharge data (BWSSB/NGT 2023), "
                "Fischer dispersion formula with Kashefipour-Falconer correction, "
                "and Metcalf & Eddy BOD decay rates. "
                "Calibrate with multi-station tracer data for site-specific accuracy."
            ),
        }

    def _ade_predict(
        self, C0: float, distances: List[int], v: float, D: float, k: float
    ) -> List[Dict]:
        results = []
        for x in distances:
            t = x / v if v > 0 else 1e6
            if t <= 0:
                t = 1

            denom = math.sqrt(4 * math.pi * D * t)
            if denom == 0:
                denom = 1e-10

            exponent = -((x - v * t) ** 2) / (4 * D * t) - k * t
            exponent = max(exponent, -50)
            C = (C0 / denom) * math.exp(exponent)

            ref_t = 1 / v if v > 0 else 1
            ref_denom = math.sqrt(4 * math.pi * D * ref_t)
            C_ref = C0 / ref_denom if ref_denom > 0 else C0

            C_normalized = min(1.0, C / C_ref) if C_ref > 0 else 0
            predicted_wqs = C0 * C_normalized

            classification = "CLEAN"
            if self.wqs_engine:
                classification = self.wqs_engine.classify_score(predicted_wqs)
            else:
                if predicted_wqs >= 0.65:
                    classification = "SEVERELY_POLLUTED"
                elif predicted_wqs >= 0.40:
                    classification = "POLLUTED"
                elif predicted_wqs >= 0.15:
                    classification = "MODERATE"

            results.append({
                "distance_m": x,
                "travel_time_min": round(t / 60, 1),
                "predicted_wqs": round(predicted_wqs, 4),
                "classification": classification,
            })

        return results

    def _stagnant_spread(self, wqs: float, D: float) -> Dict:
        """2D radial diffusion for stagnant water bodies."""
        time_hours = [1, 3, 6, 12, 24, 48]
        results = []
        for hours in time_hours:
            t = hours * 3600
            radius = math.sqrt(4 * D * t)
            C_edge = wqs * math.exp(-1)
            results.append({
                "time_hours": hours,
                "contamination_radius_m": round(radius, 1),
                "edge_wqs": round(C_edge, 4),
                "edge_classification": (
                    "SEVERELY_POLLUTED" if C_edge >= 0.65
                    else "POLLUTED" if C_edge >= 0.40
                    else "MODERATE" if C_edge >= 0.15
                    else "CLEAN"
                ),
            })

        return {
            "spread_needed": True,
            "model": "2D_radial_diffusion",
            "source_wqs": round(wqs, 4),
            "dispersion_coefficient": D,
            "predictions": results,
            "assumptions": (
                f"2D radial diffusion in stagnant water (D={D} m²/s). "
                "Assumes uniform depth and no advection."
            ),
            "methodology_note": "Radial diffusion: r(t) = sqrt(4Dt). Concentration decays as C0*exp(-r²/4Dt).",
        }

    @staticmethod
    def _extract_geometry(element) -> List[Tuple[float, float]]:
        geom = element.get("geometry", [])
        return [(node["lat"], node["lon"]) for node in geom if "lat" in node]

    @staticmethod
    def _min_dist_to_geom(lat, lon, geom):
        if not geom:
            return float("inf")
        min_d = float("inf")
        for glat, glon in geom:
            dlat = math.radians(glat - lat)
            dlon = math.radians(glon - lon)
            a = (math.sin(dlat / 2) ** 2
                 + math.cos(math.radians(lat)) * math.cos(math.radians(glat))
                 * math.sin(dlon / 2) ** 2)
            d = 6_371_000 * 2 * math.asin(math.sqrt(a))
            if d < min_d:
                min_d = d
        return min_d

    @staticmethod
    def _extract_downstream_path(lat, lon, geometry) -> List[Tuple[float, float]]:
        if not geometry:
            return []
        closest_idx = 0
        min_d = float("inf")
        for i, (glat, glon) in enumerate(geometry):
            d = (glat - lat) ** 2 + (glon - lon) ** 2
            if d < min_d:
                min_d = d
                closest_idx = i
        return geometry[closest_idx:]

    @staticmethod
    def _interpolate_coord(
        lat, lon, distance_m, downstream_path
    ) -> Optional[Tuple[float, float]]:
        if not downstream_path:
            bearing_rad = math.pi
            d_lat = (distance_m / 6_371_000) * (180 / math.pi)
            return (round(lat - d_lat, 6), round(lon, 6))

        cumulative = 0.0
        for i in range(len(downstream_path) - 1):
            p1 = downstream_path[i]
            p2 = downstream_path[i + 1]
            seg_len = math.sqrt(
                ((p2[0] - p1[0]) * 111320) ** 2
                + ((p2[1] - p1[1]) * 111320 * math.cos(math.radians(p1[0]))) ** 2
            )
            if cumulative + seg_len >= distance_m:
                frac = (distance_m - cumulative) / seg_len if seg_len > 0 else 0
                ilat = p1[0] + frac * (p2[0] - p1[0])
                ilon = p1[1] + frac * (p2[1] - p1[1])
                return (round(ilat, 6), round(ilon, 6))
            cumulative += seg_len

        if downstream_path:
            return downstream_path[-1]
        return None
