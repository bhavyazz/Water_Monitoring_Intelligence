// Centralized Location Provider for the UI
// Coordinates prioritize:
// 1. Live GPS coordinates (if available and valid)
// 2. Current Device Location (via browser geolocation prompt on startup)
// 3. Last Known Location (loaded from localStorage cache)
// 4. Configured Demo Coordinates (fallback, via VITE_DEMO_LATITUDE / VITE_DEMO_LONGITUDE env variables)
// 5. Existing hardcoded values (last resort)

import { useState, useEffect } from 'react';

export const DEFAULT_LATITUDE = 12.9716;
export const DEFAULT_LONGITUDE = 77.5946;

// Internal central location coordinates state and source
let centralLatitude = null;
let centralLongitude = null;
let centralSource = 'Default Fallback Coordinates';

// Cache key for persisting geolocation
const CACHE_KEY = 'water_monitor_last_known_location';

// Registry of listeners for location update events
const listeners = [];

/**
 * Returns resolved coordinates and source.
 */
export function getActiveLocationWithSource(gpsLat, gpsLon) {
  // Priority 1: GPS Coordinates when available and valid (real device overrides everything)
  if (gpsLat !== undefined && gpsLat !== null && !isNaN(gpsLat) && Math.abs(gpsLat) > 0.0001) {
    if (gpsLon !== undefined && gpsLon !== null && !isNaN(gpsLon) && Math.abs(gpsLon) > 0.0001) {
      return [parseFloat(gpsLat), parseFloat(gpsLon), 'GPS'];
    }
  }

  // Priority 2 / 3: Geolocation detected on startup or loaded from cache
  if (centralLatitude !== null && centralLongitude !== null) {
    return [centralLatitude, centralLongitude, centralSource];
  }

  // Priority 4: Configured Demo Coordinates (from Vite environment variables)
  const configLat = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DEMO_LATITUDE
    ? parseFloat(import.meta.env.VITE_DEMO_LATITUDE)
    : null;
  const configLon = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DEMO_LONGITUDE
    ? parseFloat(import.meta.env.VITE_DEMO_LONGITUDE)
    : null;

  if (configLat !== null && !isNaN(configLat) && configLon !== null && !isNaN(configLon)) {
    return [configLat, configLon, 'Demo Environment Variables'];
  }

  // Priority 5: Existing hardcoded values (last resort)
  return [DEFAULT_LATITUDE, DEFAULT_LONGITUDE, 'Default Fallback Coordinates'];
}

/**
 * Returns resolved coordinates only.
 */
export function getActiveLocation(gpsLat, gpsLon) {
  const [lat, lon] = getActiveLocationWithSource(gpsLat, gpsLon);
  return [lat, lon];
}

/**
 * Subscribe a component or data module to location update events.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToLocation(callback) {
  listeners.push(callback);
  
  // Call immediately with the current state to initialize
  const [lat, lon, source] = getActiveLocationWithSource();
  callback(lat, lon, source);
  
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) {
      listeners.splice(idx, 1);
    }
  };
}

/**
 * Updates the central location state, updates caches, notifies listeners,
 * and synchronizes the location to the backend API.
 */
export function updateCentralLocation(lat, lon, source) {
  const lat_f = parseFloat(lat);
  const lon_f = parseFloat(lon);
  
  if (isNaN(lat_f) || isNaN(lon_f)) return;
  
  centralLatitude = lat_f;
  centralLongitude = lon_f;
  centralSource = source;
  
  console.log(`[LocationProvider] Active coordinates set to (${lat_f.toFixed(6)}, ${lon_f.toFixed(6)}) via ${source}`);

  // Notify all subscribed listeners
  listeners.forEach(callback => {
    try {
      callback(lat_f, lon_f, source);
    } catch (e) {
      console.error("Error executing location listener callback:", e);
    }
  });
}

/**
 * Synchronize location update to backend Fast-API server so simulator coordinates align.
 */
async function syncLocationToBackend(lat, lon, source) {
  try {
    const resp = await fetch('http://localhost:8000/location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude: lat,
        longitude: lon,
        source: source
      })
    });
    const result = await resp.json();
    console.log('[LocationProvider] Synchronised with backend:', result);
  } catch (err) {
    console.warn('[LocationProvider] Synchronisation to backend failed (backend may be starting up):', err.message);
  }
}

/**
 * React state hook for coordinates. Auto-updates when location is detected.
 */
export function useActiveLocation(gpsLat, gpsLon) {
  const [locationState, setLocationState] = useState(() => {
    return getActiveLocationWithSource(gpsLat, gpsLon);
  });

  useEffect(() => {
    // If a valid live GPS override is provided, bypass central subscription updates
    if (gpsLat !== undefined && gpsLat !== null && !isNaN(gpsLat) && Math.abs(gpsLat) > 0.0001) {
      if (gpsLon !== undefined && gpsLon !== null && !isNaN(gpsLon) && Math.abs(gpsLon) > 0.0001) {
        setLocationState([parseFloat(gpsLat), parseFloat(gpsLon), 'GPS']);
        return;
      }
    }

    // Subscribe to central updates (triggered by device detection, updates, or cache fetches)
    return subscribeToLocation((lat, lon, source) => {
      setLocationState([lat, lon, source]);
    });
  }, [gpsLat, gpsLon]);

  return locationState;
}

// ── Startup Location Detection ───────────────────────────────────────
if (typeof window !== 'undefined') {
  // A. First try to load cached last known coordinates to initialize instantly
  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (cached) {
      const [lat, lon] = JSON.parse(cached);
      updateCentralLocation(lat, lon, 'Last Known Location');
      // Sync cached location to backend in case it restarted
      syncLocationToBackend(lat, lon, 'Last Known Location');
    }
  } catch (e) {
    console.warn('[LocationProvider] Cache read failed:', e);
  }

  // B. Trigger asynchronous browser geolocation prompt
  if (navigator.geolocation) {
    console.log('[LocationProvider] Initiating browser Geolocation detection...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        console.log(`[LocationProvider] Browser Geolocation success: (${lat.toFixed(6)}, ${lon.toFixed(6)})`);
        
        // Cache locally in localStorage
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify([lat, lon]));
        } catch (e) {
          console.warn('[LocationProvider] Cache write failed:', e);
        }
        
        // Update provider and notify app
        updateCentralLocation(lat, lon, 'Browser Geolocation');
        // Synchronise browser coordinates to FastAPI backend simulator
        syncLocationToBackend(lat, lon, 'Browser Geolocation');
      },
      (error) => {
        console.warn(`[LocationProvider] Geolocation lookup failed: ${error.message} (Code: ${error.code})`);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  } else {
    console.warn('[LocationProvider] Browser navigator.geolocation is not supported on this environment.');
  }
}
