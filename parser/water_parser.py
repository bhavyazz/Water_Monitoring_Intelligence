"""
water_parser.py — Sensor Data Parser

Converts raw semicolon-delimited sensor strings into structured
``WaterReading`` objects.  Handles malformed input gracefully — a bad
field is set to ``None`` / a default rather than crashing the pipeline.

Expected input format:
    T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971234;LON:77.594321;RGB:120,98,76
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)


@dataclass
class WaterReading:
    """
    Immutable snapshot of one parsed sensor reading.

    All numeric fields are ``Optional`` — a ``None`` value means the
    corresponding sensor token was missing or unparseable.
    """
    temperature: Optional[float] = None   # °C
    tds: Optional[float] = None           # ppm (Total Dissolved Solids)
    turbidity: Optional[float] = None     # NTU
    level: Optional[float] = None         # mm  (water level)
    latitude: Optional[float] = None      # decimal degrees
    longitude: Optional[float] = None     # decimal degrees
    rgb: Optional[Tuple[int, int, int]] = None  # (R, G, B)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # ── Enriched fields (filled by downstream stages) ─────────────
    nitrate: Optional[float] = None       # ppm  (predicted)
    quality_label: Optional[str] = None   # Safe / Moderate / Unsafe
    bloom_risk: Optional[str] = None      # LOW / MODERATE / HIGH

    def to_dict(self) -> dict:
        """Serialise to a JSON-friendly dictionary."""
        return {
            "temperature": self.temperature,
            "tds": self.tds,
            "turbidity": self.turbidity,
            "level": self.level,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "rgb": list(self.rgb) if self.rgb else None,
            "timestamp": self.timestamp.isoformat(),
            "nitrate": self.nitrate,
            "quality_label": self.quality_label,
            "bloom_risk": self.bloom_risk,
        }


class WaterParser:
    """
    Stateless parser that converts raw sensor strings into
    ``WaterReading`` instances.
    """

    # Mapping from token prefix → WaterReading attribute name
    _TOKEN_MAP = {
        "T":     "temperature",
        "TDS":   "tds",
        "TURB":  "turbidity",
        "LEVEL": "level",
        "LAT":   "latitude",
        "LON":   "longitude",
        "RGB":   "rgb",
    }

    @staticmethod
    def _parse_rgb(raw: str) -> Optional[Tuple[int, int, int]]:
        """
        Parse an ``R,G,B`` string into a 3-tuple of ints.

        Returns ``None`` if the format is invalid.
        """
        try:
            parts = [int(x.strip()) for x in raw.split(",")]
            if len(parts) != 3:
                return None
            return (parts[0], parts[1], parts[2])
        except (ValueError, AttributeError):
            return None

    @classmethod
    def parse(cls, raw_line: str) -> Optional[WaterReading]:
        """
        Parse a single raw sensor string.

        Args:
            raw_line: e.g. ``T:28.5;TDS:320;TURB:2.1;...``

        Returns:
            A ``WaterReading`` on success, or ``None`` if the line is
            completely unparseable (empty / no valid tokens at all).
        """
        if not raw_line or not raw_line.strip():
            logger.warning("Received empty sensor line — skipping.")
            return None

        kwargs: dict = {}
        tokens = raw_line.strip().split(";")

        for token in tokens:
            # Each token has the form  KEY:VALUE
            if ":" not in token:
                logger.debug("Skipping malformed token (no colon): %r", token)
                continue

            key, _, value = token.partition(":")
            key = key.strip().upper()
            value = value.strip()

            attr = cls._TOKEN_MAP.get(key)
            if attr is None:
                logger.debug("Unknown sensor key %r — ignored.", key)
                continue

            # RGB needs special handling
            if attr == "rgb":
                kwargs[attr] = cls._parse_rgb(value)
                continue

            # Everything else is a float
            try:
                kwargs[attr] = float(value)
            except ValueError:
                logger.warning("Could not parse %s value %r as float.", key, value)
                kwargs[attr] = None

        # If we extracted zero usable fields, treat the line as junk
        if not kwargs:
            logger.warning("No valid fields parsed from line: %r", raw_line)
            return None

        return WaterReading(**kwargs)


# ── Standalone demo ───────────────────────────────────────────────────
if __name__ == "__main__":
    sample = "T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971234;LON:77.594321;RGB:120,98,76"
    reading = WaterParser.parse(sample)
    if reading:
        print("Parsed reading:")
        for k, v in reading.to_dict().items():
            print(f"  {k}: {v}")
