"""
spread_analyzer.py — Pollution Spread Direction & Speed Analysis

Tracks how a cluster's centroid moves over time to infer:
  • Spread direction (N, NE, E, SE, S, SW, W, NW)
  • Spread speed (km/h)

Algorithm:
  1. Split cluster readings into two time halves (early vs. late).
  2. Compute centroid of each half.
  3. dx = late_lon - early_lon,  dy = late_lat - early_lat
  4. Direction = atan2-based compass bearing.
  5. Speed = haversine(early_centroid, late_centroid) / elapsed_time.
"""

from __future__ import annotations
import math
from typing import List, Optional, Tuple
from parser.water_parser import WaterReading


# 8-point compass directions
_COMPASS = [
    ("North", 0),
    ("North-East", 45),
    ("East", 90),
    ("South-East", 135),
    ("South", 180),
    ("South-West", 225),
    ("West", 270),
    ("North-West", 315),
]


def _bearing_to_direction(bearing_deg: float) -> str:
    """Map a bearing (0–360°, 0=N, 90=E) to a compass label."""
    bearing_deg = bearing_deg % 360
    best = "North"
    best_diff = 999.0
    for name, angle in _COMPASS:
        diff = abs(bearing_deg - angle)
        if diff > 180:
            diff = 360 - diff
        if diff < best_diff:
            best_diff = diff
            best = name
    return best


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in kilometres."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


class SpreadAnalyzer:
    """Analyse temporal movement of a pollution cluster."""

    @staticmethod
    def analyze(readings: List[WaterReading]) -> Tuple[Optional[str], Optional[str]]:
        """
        Determine spread direction and speed from timestamped readings.

        Returns:
            (direction_label, speed_string)  or  (None, None) if
            insufficient data.
        """
        # Need at least 4 readings to split meaningfully
        valid = [r for r in readings if r.latitude is not None and r.longitude is not None]
        if len(valid) < 4:
            return None, None

        # Sort by timestamp
        valid.sort(key=lambda r: r.timestamp)

        mid = len(valid) // 2
        early = valid[:mid]
        late = valid[mid:]

        # Centroids
        e_lat = sum(r.latitude for r in early) / len(early)
        e_lon = sum(r.longitude for r in early) / len(early)
        l_lat = sum(r.latitude for r in late) / len(late)
        l_lon = sum(r.longitude for r in late) / len(late)

        # Direction (bearing)
        dy = l_lat - e_lat
        dx = l_lon - e_lon
        bearing = math.degrees(math.atan2(dx, dy))  # 0° = North

        direction = _bearing_to_direction(bearing)

        # Speed
        dist_km = _haversine_km(e_lat, e_lon, l_lat, l_lon)
        dt_seconds = (late[-1].timestamp - early[0].timestamp).total_seconds()
        if dt_seconds <= 0:
            return direction, "0.0 km/h"

        speed_kmh = dist_km / (dt_seconds / 3600.0)
        speed_str = f"{speed_kmh:.2f} km/h"

        return direction, speed_str
