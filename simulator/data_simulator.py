"""
data_simulator.py — Hardware Emulation Layer

Simulates an Arduino equipped with water quality sensors:
  - DS18B20 temperature sensor (20–35 °C)
  - TDS meter (200–1000 ppm)
  - Turbidity sensor (1–5 NTU)
  - Ultrasonic water level sensor (0–500 mm)
  - GPS module (slight random walk around a base coordinate)
  - Nitrate strip color sensor (RGB values)

Output format (one line every ~2 seconds):
  T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971234;LON:77.594321;RGB:120,98,76
"""

import random
import time
import math
from typing import Generator


class DataSimulator:
    """
    Generates realistic, correlated sensor readings that mimic a moving
    water-quality monitoring buoy.  Values exhibit temporal correlation
    (each new value is close to the previous one) so that downstream
    smoothing / ML behaves realistically.
    """

    # ── Base GPS location (RVCE, Bangalore) ────────────────────────────
    BASE_LAT = 12.9240
    BASE_LON = 77.4990

    def __init__(self, seed: int | None = None):
        """
        Args:
            seed: Optional RNG seed for reproducible simulations.
        """
        self.rng = random.Random(seed)

        # Internal state — values evolve smoothly via random walk
        self._temp = 27.0       # °C
        self._tds = 450.0       # ppm
        self._turb = 2.5        # NTU
        self._level = 350.0     # mm
        self._lat = self.BASE_LAT
        self._lon = self.BASE_LON

        # Nitrate-strip RGB baseline (greenish tint = moderate nitrate)
        self._r = 120
        self._g = 100
        self._b = 80

    # ── Private helpers ───────────────────────────────────────────────

    @staticmethod
    def _clamp(value: float, lo: float, hi: float) -> float:
        """Clamp *value* to the closed interval [lo, hi]."""
        return max(lo, min(hi, value))

    def _walk(self, current: float, step: float, lo: float, hi: float) -> float:
        """
        Random-walk *current* by at most ±step, clamped to [lo, hi].
        This produces temporally-correlated sensor noise.
        """
        delta = self.rng.uniform(-step, step)
        return self._clamp(current + delta, lo, hi)

    # ── Public API ────────────────────────────────────────────────────

    def generate_reading(self) -> str:
        """
        Advance internal state by one tick and return a sensor-data
        string in the canonical format.

        Returns:
            Formatted string, e.g.
            ``T:28.5;TDS:320;TURB:2.1;LEVEL:380;LAT:12.971234;LON:77.594321;RGB:120,98,76``
        """
        # Evolve each sensor value via a bounded random walk
        self._temp  = self._walk(self._temp,  0.5, 20.0, 35.0)
        self._tds   = self._walk(self._tds,   25.0, 200.0, 1000.0)
        self._turb  = self._walk(self._turb,  0.2, 1.0, 5.0)
        self._level = self._walk(self._level,  10.0, 0.0, 500.0)

        # GPS: tiny drift (~11 m per tick at the equator)
        self._lat = self._walk(self._lat, 0.0001, self.BASE_LAT - 0.01, self.BASE_LAT + 0.01)
        self._lon = self._walk(self._lon, 0.0001, self.BASE_LON - 0.01, self.BASE_LON + 0.01)

        # RGB: simulate nitrate-strip colour shifts
        self._r = int(self._walk(self._r, 5, 50, 220))
        self._g = int(self._walk(self._g, 5, 40, 200))
        self._b = int(self._walk(self._b, 5, 30, 180))

        return (
            f"T:{self._temp:.1f};"
            f"TDS:{self._tds:.0f};"
            f"TURB:{self._turb:.1f};"
            f"LEVEL:{self._level:.0f};"
            f"LAT:{self._lat:.6f};"
            f"LON:{self._lon:.6f};"
            f"RGB:{self._r},{self._g},{self._b}"
        )

    def stream(self, interval: float = 2.0, count: int | None = None) -> Generator[str, None, None]:
        """
        Yield sensor strings at *interval*-second cadence.

        Args:
            interval: Seconds between readings (default 2).
            count:    Stop after this many readings; ``None`` = infinite.

        Yields:
            Raw sensor string per the canonical format.
        """
        produced = 0
        while count is None or produced < count:
            yield self.generate_reading()
            produced += 1
            if count is None or produced < count:
                time.sleep(interval)


# ── Standalone demo ───────────────────────────────────────────────────
if __name__ == "__main__":
    sim = DataSimulator(seed=42)
    print("=== Water Quality Data Simulator ===")
    print("Press Ctrl+C to stop.\n")
    try:
        for line in sim.stream(interval=2.0):
            print(line)
    except KeyboardInterrupt:
        print("\nSimulation stopped.")
