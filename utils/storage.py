"""
storage.py — In-Memory Ring-Buffer Storage

Keeps the last N water readings in a deque (default 500).
Thread-safe via a simple lock.
"""

from __future__ import annotations
from collections import deque
from threading import Lock
from typing import List
from parser.water_parser import WaterReading


class StorageEngine:
    """Thread-safe, fixed-capacity in-memory reading store."""

    def __init__(self, capacity: int = 500):
        self._buf: deque[WaterReading] = deque(maxlen=capacity)
        self._lock = Lock()

    def add(self, reading: WaterReading) -> None:
        with self._lock:
            self._buf.append(reading)

    def latest(self) -> WaterReading | None:
        with self._lock:
            return self._buf[-1] if self._buf else None

    def last_n(self, n: int = 50) -> List[WaterReading]:
        with self._lock:
            items = list(self._buf)
            return items[-n:]

    def all(self) -> List[WaterReading]:
        with self._lock:
            return list(self._buf)

    def count(self) -> int:
        with self._lock:
            return len(self._buf)

    def clear(self) -> None:
        """Clear all stored readings."""
        with self._lock:
            self._buf.clear()

