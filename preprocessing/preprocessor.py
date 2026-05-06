"""
preprocessor.py — Signal Smoothing & Normalisation

Applies a **moving-average filter** to noisy TDS and Turbidity streams,
and optionally normalises RGB values to [0, 1] for ML consumption.

Design notes:
  • The preprocessor is stateful — it keeps an internal sliding window
    per channel so it can be fed readings one at a time.
  • Window size is configurable (default 5).
"""

from __future__ import annotations
from collections import deque
from typing import Optional, Tuple
from parser.water_parser import WaterReading


class Preprocessor:
    """
    Stateful preprocessor that smooths TDS / Turbidity readings via
    a simple moving average and normalises RGB values.
    """

    def __init__(self, window_size: int = 5):
        """
        Args:
            window_size: Number of recent values to average over.
        """
        self.window_size = window_size

        # Separate sliding windows for each smoothed channel
        self._tds_window: deque[float] = deque(maxlen=window_size)
        self._turb_window: deque[float] = deque(maxlen=window_size)

    # ── Helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _moving_avg(window: deque[float]) -> float:
        """Return the arithmetic mean of elements in *window*."""
        return sum(window) / len(window)

    @staticmethod
    def normalize_rgb(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
        """
        Normalise an (R, G, B) tuple from [0, 255] → [0.0, 1.0].

        This is the expected input range for the nitrate-prediction model.
        """
        return (rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0)

    # ── Public API ────────────────────────────────────────────────────

    def process(self, reading: WaterReading) -> WaterReading:
        """
        Smooth TDS / Turbidity and normalise RGB in-place.

        The original ``WaterReading`` object is mutated and returned
        for convenience (no copy is made).

        Args:
            reading: A freshly parsed ``WaterReading``.

        Returns:
            The same ``WaterReading`` with smoothed / normalised fields.
        """
        # ── Smooth TDS ────────────────────────────────────────────────
        if reading.tds is not None:
            self._tds_window.append(reading.tds)
            reading.tds = round(self._moving_avg(self._tds_window), 1)

        # ── Smooth Turbidity ──────────────────────────────────────────
        if reading.turbidity is not None:
            self._turb_window.append(reading.turbidity)
            reading.turbidity = round(self._moving_avg(self._turb_window), 2)

        # ── Normalise RGB (store normalised version back) ─────────────
        # We keep the original integer RGB for display and store the
        # normalised version in a temporary attribute for ML inference.
        if reading.rgb is not None:
            reading._rgb_norm = self.normalize_rgb(reading.rgb)  # type: ignore[attr-defined]

        return reading

    def reset(self) -> None:
        """Clear internal smoothing windows (e.g. on sensor reset)."""
        self._tds_window.clear()
        self._turb_window.clear()


# ── Standalone demo ───────────────────────────────────────────────────
if __name__ == "__main__":
    from parser.water_parser import WaterParser

    lines = [
        "T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971;LON:77.594;RGB:120,98,76",
        "T:29.0;TDS:350;TURB:2.3;LEVEL:375;LAT:12.971;LON:77.594;RGB:125,100,80",
        "T:28.8;TDS:310;TURB:2.0;LEVEL:382;LAT:12.972;LON:77.595;RGB:118,95,74",
    ]

    pp = Preprocessor(window_size=3)
    for line in lines:
        reading = WaterParser.parse(line)
        if reading:
            pp.process(reading)
            print(f"Smoothed TDS={reading.tds}, Turb={reading.turbidity}")
