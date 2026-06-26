"""
osm_client.py — Resilient Overpass API client

Two failure modes this guards against:
  1. HTTP 406 — Overpass rejects the default python-requests User-Agent.
     A descriptive UA is mandatory.
  2. HTTP 429 / timeouts — Overpass rate-limits repeated/concurrent requests.
     We retry across public mirrors and cache results (geography is static,
     so the same coordinate never needs to hit the network twice).
"""

from __future__ import annotations
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

OVERPASS_HEADERS = {
    "User-Agent": "AquaVision/1.0 (water-quality-monitoring; RVCE Bangalore)"
}

# Coordinate-keyed response cache. Geography doesn't change, so once we've
# resolved a point we never need to re-query it within a session.
_CACHE: Dict[str, Any] = {}
_CACHE_MAX = 512


def cache_get(key: str):
    return _CACHE.get(key)


def cache_put(key: str, value: Any) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.clear()
    _CACHE[key] = value


def overpass_post(query: str, timeout: int = 15, retries: int = 1) -> Dict[str, Any]:
    """POST a query to Overpass, trying each mirror with retry/backoff.

    Returns parsed JSON. Raises the last exception if every mirror fails.
    """
    import requests

    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        for url in OVERPASS_MIRRORS:
            try:
                resp = requests.post(
                    url, data={"data": query},
                    headers=OVERPASS_HEADERS, timeout=timeout,
                )
                if resp.status_code == 429:
                    last_err = Exception(f"429 rate-limited at {url}")
                    continue
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                last_err = e
                continue
        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))  # backoff before next full sweep

    raise last_err if last_err else RuntimeError("Overpass query failed")
