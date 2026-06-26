"""
spread_analyzer.py — Pollution Spread Analysis via Water Body Network

Models how pollution propagates through connected water bodies using
an exponential distance-decay function:

    spread_risk(B) = contamination_score(A) × e^(-λ × distance_km)

where:
    A = source hotspot
    B = downstream water body
    λ = decay factor (default 0.2, tuned for river transport)
    distance_km = network distance along connected water bodies

Algorithm: BFS traversal through the water body connectivity graph,
propagating risk from the pollution source outward. Risk compounds
through intermediate nodes.

Validation: tested against Vrushabavathi River case study with known
pollution gradient from industrial upstream to agricultural downstream.
"""

from __future__ import annotations
import math
from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


@dataclass
class SpreadRisk:
    """Pollution spread risk for one water body."""
    water_body_id: str
    water_body_name: str
    risk_score: float          # 0-100
    distance_from_source: float  # km (cumulative along network)
    risk_level: str            # HIGH / MODERATE / LOW / NEGLIGIBLE
    path_from_source: List[str]  # chain of water bodies from source


class SpreadAnalyzer:
    """
    Analyse pollution spread through a water body connectivity network.

    The network is a weighted undirected graph where nodes are water
    bodies and edge weights are distances in km.
    """

    DECAY_FACTOR = 0.2

    def __init__(
        self,
        water_bodies: Dict[str, dict],
        connections: Dict[str, List[Tuple[str, float]]],
        decay_factor: float = 0.2,
    ):
        """
        Args:
            water_bodies: {id: {name, latitude, longitude, body_type, ...}}
            connections:  {id: [(neighbor_id, distance_km), ...]}
            decay_factor: λ in the exponential decay formula
        """
        self.water_bodies = water_bodies
        self.connections = connections
        self.decay_factor = decay_factor

    def analyze_spread(
        self,
        source_id: str,
        contamination_score: float,
        min_risk_threshold: float = 3.0,
    ) -> List[SpreadRisk]:
        """
        Compute spread risk from a pollution source to connected water bodies.

        Uses BFS to traverse the water body network, applying exponential
        decay at each hop based on distance.

        Args:
            source_id:           ID of the water body where pollution originates.
            contamination_score: WQI score (0-100) at the source.
            min_risk_threshold:  Stop propagation below this risk level.

        Returns:
            List of SpreadRisk objects, sorted by risk (descending).
        """
        if source_id not in self.water_bodies:
            logger.warning("Unknown water body ID: %s", source_id)
            return []

        results: Dict[str, SpreadRisk] = {}
        visited: set = set()

        # BFS queue: (water_body_id, current_risk, cumulative_distance, path)
        queue: deque = deque()
        queue.append((source_id, contamination_score, 0.0, [source_id]))

        while queue:
            current_id, current_risk, cumulative_dist, path = queue.popleft()

            if current_id in visited:
                continue
            visited.add(current_id)

            wb = self.water_bodies.get(current_id, {})
            wb_name = wb.get("name", current_id) if isinstance(wb, dict) else getattr(wb, "name", current_id)

            risk_level = self._classify_risk(current_risk)

            results[current_id] = SpreadRisk(
                water_body_id=current_id,
                water_body_name=wb_name,
                risk_score=round(current_risk, 2),
                distance_from_source=round(cumulative_dist, 2),
                risk_level=risk_level,
                path_from_source=list(path),
            )

            for neighbor_id, distance in self.connections.get(current_id, []):
                if neighbor_id not in visited:
                    propagated_risk = current_risk * math.exp(
                        -self.decay_factor * distance
                    )
                    if propagated_risk >= min_risk_threshold:
                        new_path = path + [neighbor_id]
                        new_dist = cumulative_dist + distance
                        queue.append((neighbor_id, propagated_risk, new_dist, new_path))

        spread_list = sorted(results.values(), key=lambda r: r.risk_score, reverse=True)

        logger.info(
            "Spread analysis from '%s' (score=%.1f): %d water bodies affected",
            source_id, contamination_score, len(spread_list),
        )
        return spread_list

    @staticmethod
    def _classify_risk(risk_score: float) -> str:
        """Classify numeric risk into categories."""
        if risk_score >= 60:
            return "HIGH"
        if risk_score >= 30:
            return "MODERATE"
        if risk_score >= 10:
            return "LOW"
        return "NEGLIGIBLE"

    def get_affected_bodies(
        self,
        source_id: str,
        contamination_score: float,
    ) -> Dict[str, float]:
        """
        Simplified interface: return {water_body_id: risk_score} dict.
        Useful for API responses and map overlays.
        """
        spread = self.analyze_spread(source_id, contamination_score)
        return {r.water_body_id: r.risk_score for r in spread}

    def to_summary(self, spread_results: List[SpreadRisk]) -> List[Dict]:
        """Convert spread results to JSON-serializable dicts."""
        return [
            {
                "water_body_id": r.water_body_id,
                "water_body_name": r.water_body_name,
                "risk_score": r.risk_score,
                "risk_level": r.risk_level,
                "distance_km": r.distance_from_source,
                "path": r.path_from_source,
            }
            for r in spread_results
        ]

    # ── Legacy interface (backward compatibility with old API) ────────

    @staticmethod
    def analyze(readings) -> Tuple[Optional[str], Optional[str]]:
        """
        Legacy method: compute spread direction/speed from timestamped readings.
        Kept for backward compatibility with existing API endpoints.
        """
        valid = [r for r in readings if r.latitude is not None and r.longitude is not None]
        if len(valid) < 4:
            return None, None

        valid.sort(key=lambda r: r.timestamp)
        mid = len(valid) // 2
        early = valid[:mid]
        late = valid[mid:]

        e_lat = sum(r.latitude for r in early) / len(early)
        e_lon = sum(r.longitude for r in early) / len(early)
        l_lat = sum(r.latitude for r in late) / len(late)
        l_lon = sum(r.longitude for r in late) / len(late)

        dy = l_lat - e_lat
        dx = l_lon - e_lon
        bearing = math.degrees(math.atan2(dx, dy)) % 360

        compass = [
            ("North", 0), ("North-East", 45), ("East", 90),
            ("South-East", 135), ("South", 180), ("South-West", 225),
            ("West", 270), ("North-West", 315),
        ]
        direction = min(compass, key=lambda c: min(abs(bearing - c[1]), 360 - abs(bearing - c[1])))[0]

        R = 6371.0
        dlat = math.radians(l_lat - e_lat)
        dlon = math.radians(l_lon - e_lon)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(e_lat)) * math.cos(math.radians(l_lat)) * math.sin(dlon / 2) ** 2
        dist_km = R * 2 * math.asin(math.sqrt(a))

        dt_seconds = (late[-1].timestamp - early[0].timestamp).total_seconds()
        if dt_seconds <= 0:
            return direction, "0.0 km/h"

        speed_kmh = dist_km / (dt_seconds / 3600.0)
        return direction, f"{speed_kmh:.2f} km/h"
