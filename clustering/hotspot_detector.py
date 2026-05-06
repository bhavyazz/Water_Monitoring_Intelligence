"""
hotspot_detector.py — DBSCAN-Based Pollution Hotspot Detection

Clusters GPS-tagged readings using DBSCAN.  For each cluster:
  • Computes centroid (mean lat/lon)
  • Computes affected radius (max distance from centroid)
  • Computes severity (mean TDS, Turbidity, Nitrate)
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
import numpy as np
from sklearn.cluster import DBSCAN
from parser.water_parser import WaterReading


@dataclass
class PollutionCluster:
    """Represents one detected pollution hotspot."""
    cluster_id: int
    center: Tuple[float, float]              # (lat, lon)
    readings: List[WaterReading] = field(default_factory=list)
    severity: str = "LOW"
    affected_radius_m: float = 0.0
    probable_source: str = "Unknown"
    spread_direction: Optional[str] = None
    spread_speed: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "cluster_id": self.cluster_id,
            "center": list(self.center),
            "probable_source": self.probable_source,
            "severity": self.severity,
            "spread_direction": self.spread_direction or "N/A",
            "spread_speed": self.spread_speed or "N/A",
            "affected_radius": f"{self.affected_radius_m:.0f} meters",
            "reading_count": len(self.readings),
        }


class HotspotDetector:
    """
    DBSCAN clustering on GPS coordinates.

    eps is in *radians* (haversine metric).  Default 200 m ≈ 0.000031 rad.
    """

    # Earth radius in meters (for haversine)
    EARTH_R = 6_371_000

    def __init__(self, eps_meters: float = 200.0, min_samples: int = 3):
        # Convert eps from meters to radians for haversine
        self.eps_rad = eps_meters / self.EARTH_R
        self.min_samples = min_samples

    @staticmethod
    def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Haversine distance in meters between two GPS points."""
        R = 6_371_000
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
        return R * 2 * math.asin(math.sqrt(a))

    @staticmethod
    def _severity_label(avg_tds: float, avg_turb: float, avg_nitr: float) -> str:
        """Determine cluster severity from average sensor values."""
        score = 0
        if avg_tds > 600:
            score += 2
        elif avg_tds > 400:
            score += 1
        if avg_turb > 3.0:
            score += 2
        elif avg_turb > 2.0:
            score += 1
        if avg_nitr > 25:
            score += 2
        elif avg_nitr > 12:
            score += 1
        if score >= 4:
            return "HIGH"
        if score >= 2:
            return "MODERATE"
        return "LOW"

    def detect(self, readings: List[WaterReading]) -> List[PollutionCluster]:
        """
        Run DBSCAN on the GPS coordinates of *readings* and return
        a list of ``PollutionCluster`` objects.
        """
        # Filter readings with valid GPS
        valid = [r for r in readings if r.latitude is not None and r.longitude is not None]
        if len(valid) < self.min_samples:
            return []

        coords = np.array([[math.radians(r.latitude), math.radians(r.longitude)] for r in valid])

        db = DBSCAN(eps=self.eps_rad, min_samples=self.min_samples, metric="haversine")
        labels = db.fit_predict(coords)

        clusters: List[PollutionCluster] = []
        unique_labels = set(labels)
        unique_labels.discard(-1)  # noise

        for cid in sorted(unique_labels):
            members = [valid[i] for i, l in enumerate(labels) if l == cid]

            # Centroid
            mean_lat = np.mean([r.latitude for r in members])
            mean_lon = np.mean([r.longitude for r in members])

            # Affected radius
            radius = max(
                self._haversine_m(mean_lat, mean_lon, r.latitude, r.longitude)
                for r in members
            )

            # Severity
            avg_tds = np.mean([r.tds for r in members if r.tds is not None]) if any(r.tds for r in members) else 0
            avg_turb = np.mean([r.turbidity for r in members if r.turbidity is not None]) if any(r.turbidity for r in members) else 0
            avg_nitr = np.mean([r.nitrate for r in members if r.nitrate is not None]) if any(r.nitrate for r in members) else 0

            cluster = PollutionCluster(
                cluster_id=int(cid),
                center=(round(float(mean_lat), 6), round(float(mean_lon), 6)),
                readings=members,
                severity=self._severity_label(float(avg_tds), float(avg_turb), float(avg_nitr)),
                affected_radius_m=round(radius, 1),
            )
            clusters.append(cluster)

        return clusters
