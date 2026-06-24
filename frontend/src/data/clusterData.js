import { SOURCES, RIVER_PATH, SENSOR_POINTS } from './syntheticData'
import { subscribeToLocation } from '../locationProvider'

const SEV_C = { HIGH: '#ff4455', MODERATE: '#ffaa00', LOW: '#44cc66' }

/* Base location variables that update reactively */
let currentBaseLat = 12.9716;
let currentBaseLon = 77.5946;

/* 4 fallback clusters when backend is unreachable with relative offsets */
export const FALLBACK_CLUSTERS = [
  { cluster_id: 0, latOffset: 0.0, lonOffset: 0.0, center: [0, 0], severity: 'HIGH', reading_count: 12, affected_radius: '180', spread_direction: 'South-East', spread_speed: '0.3 km/h', probable_source: 'Industrial Discharge', readings: [] },
  { cluster_id: 1, latOffset: 0.0009, lonOffset: -0.0008, center: [0, 0], severity: 'MODERATE', reading_count: 8, affected_radius: '120', spread_direction: 'East', spread_speed: '0.1 km/h', probable_source: 'Sewage Contamination', readings: [] },
  { cluster_id: 2, latOffset: -0.0016, lonOffset: 0.0009, center: [0, 0], severity: 'LOW', reading_count: 5, affected_radius: '90', spread_direction: 'North', spread_speed: '0.05 km/h', probable_source: 'Agricultural Runoff', readings: [] },
  { cluster_id: 3, latOffset: -0.0006, lonOffset: 0.0014, center: [0, 0], severity: 'MODERATE', reading_count: 7, affected_radius: '150', spread_direction: 'South', spread_speed: '0.2 km/h', probable_source: 'Unknown', readings: [] },
]

/* Generate synthetic readings with fixed spatial offsets relative to their cluster's dynamic center */
FALLBACK_CLUSTERS.forEach(c => {
  for (let i = 0; i < c.reading_count; i++) {
    const sevMult = c.severity === 'HIGH' ? 1.5 : c.severity === 'MODERATE' ? 1 : 0.6
    const rLatOffset = (Math.random() - 0.5) * 0.002
    const rLonOffset = (Math.random() - 0.5) * 0.002
    c.readings.push({
      latOffset: rLatOffset,
      lonOffset: rLonOffset,
      latitude: 0,
      longitude: 0,
      tds: 300 + Math.random() * 400 * sevMult,
      turbidity: 1.5 + Math.random() * 2.5 * sevMult,
      nitrate: 8 + Math.random() * 20 * sevMult,
      temperature: 24 + Math.random() * 8,
      timestamp: new Date(Date.now() - (c.reading_count - i) * 120000).toISOString(),
    })
  }
})

// Subscribe to dynamic active coordinates
subscribeToLocation((lat, lon) => {
  currentBaseLat = lat;
  currentBaseLon = lon;
  
  FALLBACK_CLUSTERS.forEach(c => {
    c.center = [lat + c.latOffset, lon + c.lonOffset];
    c.readings.forEach(r => {
      r.latitude = c.center[0] + r.latOffset;
      r.longitude = c.center[1] + r.lonOffset;
    });
  });
});

/* 72-hour cluster evolution data */
export function genEvolution() {
  const events = []
  const snapshots = []
  const births = [
    { id: 0, hour: 2, cx: 300, cy: 200, r: 15, severity: 'LOW', maxR: 55 },
    { id: 1, hour: 6, cx: 500, cy: 280, r: 12, severity: 'LOW', maxR: 40 },
    { id: 2, hour: 14, cx: 700, cy: 220, r: 10, severity: 'LOW', maxR: 35 },
    { id: 3, hour: 22, cx: 400, cy: 260, r: 14, severity: 'LOW', maxR: 45 },
  ]

  for (let h = 0; h <= 72; h++) {
    const active = []
    births.forEach(b => {
      if (h < b.hour) return
      const age = h - b.hour
      // Birth event
      if (h === b.hour) events.push({ hour: h, type: 'birth', id: b.id, msg: `Cluster ${b.id} born — initial detection with ${3 + b.id} readings` })
      // Growth
      const growth = Math.min(1, age / 30)
      let r = b.r + (b.maxR - b.r) * growth
      let cx = b.cx + age * 0.3  // drift downstream
      let cy = b.cy + Math.sin(age * 0.1) * 5
      let sev = r > 40 ? 'HIGH' : r > 25 ? 'MODERATE' : 'LOW'
      // Severity change events
      if (age === 12 && b.id <= 1) events.push({ hour: h, type: 'escalate', id: b.id, msg: `Cluster ${b.id} escalated to MODERATE — TDS exceeded 500 ppm` })
      if (age === 28 && b.id === 0) events.push({ hour: h, type: 'escalate', id: b.id, msg: `Cluster ${b.id} escalated to HIGH — multiple parameters critical` })
      // Merge: cluster 3 merges into cluster 1 at hour 40
      if (b.id === 3 && h >= 40) {
        if (h === 40) events.push({ hour: h, type: 'merge', id: 3, msg: `Cluster 3 merged into Cluster 1 — zones overlapped` })
        return // cluster 3 dies
      }
      if (b.id === 1 && h >= 40) r += 15 // absorb cluster 3
      // Dispersion: cluster 2 disperses at hour 60
      if (b.id === 2 && h >= 60) {
        if (h === 60) events.push({ hour: h, type: 'disperse', id: 2, msg: `Cluster 2 dispersed — readings below DBSCAN density` })
        if (h > 62) return
        r *= Math.max(0, 1 - (h - 60) * 0.4) // fade out
        sev = 'LOW'
      }
      active.push({ id: b.id, cx, cy, r, sev, age })
    })
    snapshots.push({ hour: h, clusters: active })
  }
  return { snapshots, events }
}

/* SVG coordinate mapping for cluster centroids */
export function gpsToSvg(lat, lon) {
  // Map GPS roughly to SVG 1100x400 space (relative to current active coordinates)
  const x = ((lon - (currentBaseLon - 0.0046)) / 0.010) * 800 + 150
  const y = (((currentBaseLat + 0.0034) - lat) / 0.008) * 300 + 50
  return { x: Math.max(30, Math.min(1070, x)), y: Math.max(30, Math.min(370, y)) }
}

/* Direction to angle (degrees) */
export const DIR_ANGLE = { North: -90, 'North-East': -45, East: 0, 'South-East': 45, South: 90, 'South-West': 135, West: 180, 'North-West': -135 }

/* Safe thresholds */
export const SAFE = { tds: 500, turbidity: 3.5, nitrate: 25, temperature: 32 }

/* River average (synthetic) */
export const AVG = { tds: 380, turbidity: 2.1, nitrate: 14, temperature: 27.5 }

export { SEV_C, SOURCES, RIVER_PATH, SENSOR_POINTS }
