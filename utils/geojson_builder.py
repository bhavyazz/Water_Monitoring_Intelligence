"""
geojson_builder.py — GeoJSON Feature Collection Builder

Converts PollutionCluster objects into a GeoJSON FeatureCollection
for map visualization.  Each cluster becomes a Point feature with
a circular buffer radius stored in properties.
"""

from __future__ import annotations
from typing import List, Dict, Any
from clustering.hotspot_detector import PollutionCluster


class GeoJSONBuilder:
    """Builds GeoJSON FeatureCollections from pollution clusters."""

    @staticmethod
    def build(clusters: List[PollutionCluster]) -> Dict[str, Any]:
        """
        Convert clusters into a GeoJSON FeatureCollection.

        Each cluster → one Point Feature with properties including
        severity, source, spread info, and radius.
        """
        features = []
        for c in clusters:
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [c.center[1], c.center[0]],  # GeoJSON = [lon, lat]
                },
                "properties": {
                    "cluster_id": c.cluster_id,
                    "severity": c.severity,
                    "probable_source": c.probable_source,
                    "affected_radius_m": c.affected_radius_m,
                    "spread_direction": c.spread_direction or "N/A",
                    "spread_speed": c.spread_speed or "N/A",
                    "reading_count": len(c.readings),
                },
            }
            features.append(feature)

        return {
            "type": "FeatureCollection",
            "features": features,
        }
