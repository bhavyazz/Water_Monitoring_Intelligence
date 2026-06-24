"""
location_provider.py — Centralized active-location provider.

Configured coordinates are prioritized according to the following rules:
  1. GPS Coordinates (when available and valid)
  2. Current Device Location (via IP geolocation on startup)
  3. Last Known Location (loaded from cache)
  4. Configured Demo Coordinates (via environment variables)
  5. Existing hardcoded values (last resort)
"""

from __future__ import annotations
import os
import json
import logging

logger = logging.getLogger(__name__)

class LocationProvider:
    # Predefined / Configured demo coordinates (fallback when GPS is not functional)
    # Developers can set these environment variables to change the location globally.
    DEMO_LATITUDE = float(os.getenv("DEMO_LATITUDE", os.getenv("VITE_DEMO_LATITUDE", "12.9716")))
    DEMO_LONGITUDE = float(os.getenv("DEMO_LONGITUDE", os.getenv("VITE_DEMO_LONGITUDE", "77.5946")))
    
    # Last resort hardcoded fallback coordinates
    HARDCODED_LATITUDE = 12.9716
    HARDCODED_LONGITUDE = 77.5946

    # Dynamic active location state
    _active_latitude: float | None = None
    _active_longitude: float | None = None
    _location_source: str = "Default Fallback Coordinates"
    
    # Cache file to store last known successful location
    _cache_file: str = ".last_known_location.json"
    
    # Track the last logged coordinates/source to prevent log spam in the loop
    _last_logged_resolved: tuple[float, float, str] | None = None

    @classmethod
    def detect_device_location(cls) -> None:
        """
        Attempts to obtain current device location using IP geolocation,
        falling back to last known location cache.
        """
        # 1. Attempt device IP Geolocation
        try:
            import requests
            logger.info("Attempting device IP geolocation lookup...")
            # Use ip-api.com (free, no key required). Timeout 3.0s to avoid hanging on start.
            resp = requests.get("http://ip-api.com/json/", timeout=3.0)
            if resp.status_code == 200:
                data = resp.json()
                lat = float(data.get("lat"))
                lon = float(data.get("lon"))
                if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
                    cls.update_location(lat, lon, "IP Geolocation")
                    logger.info("Current device location successfully detected: (%.6f, %.6f) via IP Geolocation", lat, lon)
                    return
        except Exception as e:
            logger.warning("IP geolocation lookup failed: %s", e)

        # 2. Fallback to Last Known Location cache
        if os.path.exists(cls._cache_file):
            try:
                with open(cls._cache_file, "r") as f:
                    cache_data = json.load(f)
                lat = float(cache_data.get("latitude"))
                lon = float(cache_data.get("longitude"))
                cls._active_latitude = lat
                cls._active_longitude = lon
                cls._location_source = "Last Known Location"
                logger.info("Loaded last known location from cache: (%.6f, %.6f) [Source: Last Known Location]", lat, lon)
                return
            except Exception as e:
                logger.warning("Failed to load last known location cache: %s", e)

        logger.info("Device geolocation and cache unavailable. Falling back to env variables / defaults.")

    @classmethod
    def update_location(cls, lat: float, lon: float, source: str) -> None:
        """
        Updates the active location coordinates and persists them to the cache.
        """
        try:
            cls._active_latitude = float(lat)
            cls._active_longitude = float(lon)
            cls._location_source = source
            
            logger.info("Active location updated to: (%.6f, %.6f) [Source: %s]", cls._active_latitude, cls._active_longitude, source)
            
            # Persist to last known cache
            cache_data = {"latitude": cls._active_latitude, "longitude": cls._active_longitude}
            with open(cls._cache_file, "w") as f:
                json.dump(cache_data, f)
        except Exception as e:
            logger.error("Failed to update location or save cache: %s", e)

    @classmethod
    def get_active_location_with_source(cls, gps_lat: float | None = None, gps_lon: float | None = None) -> tuple[float, float, str]:
        """
        Retrieves the active coordinates and the source name using the priority rules:
          1. GPS Coordinates (when available and valid)
          2. Detected Device Location (IP Geolocation on startup / Browser geolocation update)
          3. Last Known Location (loaded from cache)
          4. Configured Demo Coordinates (fallback)
          5. Existing hardcoded values (last resort)
        """
        resolved_lat = cls.HARDCODED_LATITUDE
        resolved_lon = cls.HARDCODED_LONGITUDE
        source = "Default Fallback Coordinates"

        # 1. GPS Coordinates (when available and valid)
        if gps_lat is not None and gps_lon is not None:
            try:
                gps_lat_f = float(gps_lat)
                gps_lon_f = float(gps_lon)
                if -90.0 <= gps_lat_f <= 90.0 and -180.0 <= gps_lon_f <= 180.0:
                    if abs(gps_lat_f) > 0.0001 and abs(gps_lon_f) > 0.0001:
                        resolved_lat = gps_lat_f
                        resolved_lon = gps_lon_f
                        source = "GPS"
            except (ValueError, TypeError):
                pass

        # 2/3. Device / Cached Coordinates
        elif cls._active_latitude is not None and cls._active_longitude is not None:
            resolved_lat = cls._active_latitude
            resolved_lon = cls._active_longitude
            source = cls._location_source

        # 4. Configured Demo Coordinates (explicit env variables)
        elif (os.getenv("DEMO_LATITUDE") or os.getenv("VITE_DEMO_LATITUDE") or 
              os.getenv("DEMO_LONGITUDE") or os.getenv("VITE_DEMO_LONGITUDE")):
            resolved_lat = cls.DEMO_LATITUDE
            resolved_lon = cls.DEMO_LONGITUDE
            source = "Demo Environment Variables"

        # Change-sensitive logging to prevent spamming logs
        resolved_tuple = (resolved_lat, resolved_lon, source)
        if cls._last_logged_resolved != resolved_tuple:
            logger.info("Resolved active location: (%.6f, %.6f) using source: %s", resolved_lat, resolved_lon, source)
            cls._last_logged_resolved = resolved_tuple

        return resolved_lat, resolved_lon, source

    @classmethod
    def get_active_location(cls, gps_lat: float | None = None, gps_lon: float | None = None) -> tuple[float, float]:
        """
        Compatibility wrapper that returns only (lat, lon) coordinates.
        """
        lat, lon, _ = cls.get_active_location_with_source(gps_lat, gps_lon)
        return lat, lon
