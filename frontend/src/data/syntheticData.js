/* 12+ sensor readings along a simulated river path with 4 source types */
import { subscribeToLocation } from '../locationProvider'

const SOURCES = [
  { id: 's1', type: 'Factory', label: 'Steel Works', x: 180, y: 120, color: '#ff4455', waste: ['Heavy metals', 'Solvents', 'Heat discharge', 'Acidic runoff'] },
  { id: 's2', type: 'Farm', label: 'Green Valley Farm', x: 420, y: 80, color: '#44cc66', waste: ['Nitrates', 'Phosphates', 'Pesticides', 'Sediment'] },
  { id: 's3', type: 'Sewage', label: 'Municipal STP', x: 620, y: 200, color: '#ffaa00', waste: ['BOD', 'Pathogens', 'Ammonia', 'Suspended solids'] },
  { id: 's4', type: 'Landfill', label: 'City Landfill', x: 850, y: 100, color: '#bb66ff', waste: ['Leachate', 'Methane', 'Heavy metals', 'Microplastics'] },
]

/* River path points for SVG */
const RIVER_PATH = 'M 40,300 C 120,280 160,200 240,220 S 350,300 440,250 S 560,180 650,230 S 780,310 880,260 S 960,200 1060,240'

/* 14 sensor readings along the river with relative geographic offsets */
const SENSOR_POINTS = [
  { id: 1, x: 100, y: 290, latOffset: 0.0064, lonOffset: -0.0046, lat: 0, lon: 0, tds: 280, turbidity: 1.2, nitrate: 5.1, temp: 24.5, level: 420, rgb: [80, 140, 100], severity: 'low', clusterId: 0, sourceId: null, spread: 'DIFFUSE' },
  { id: 2, x: 170, y: 230, latOffset: 0.0054, lonOffset: -0.0036, lat: 0, lon: 0, tds: 620, turbidity: 3.8, nitrate: 28.5, temp: 31.2, level: 380, rgb: [180, 80, 60], severity: 'high', clusterId: 1, sourceId: 's1', spread: 'CONCENTRATED' },
  { id: 3, x: 220, y: 215, latOffset: 0.0049, lonOffset: -0.0028, lat: 0, lon: 0, tds: 510, turbidity: 3.1, nitrate: 22.0, temp: 29.8, level: 390, rgb: [160, 90, 70], severity: 'high', clusterId: 1, sourceId: 's1', spread: 'LINEAR' },
  { id: 4, x: 300, y: 260, latOffset: 0.0039, lonOffset: -0.0016, lat: 0, lon: 0, tds: 380, turbidity: 2.0, nitrate: 12.3, temp: 26.0, level: 410, rgb: [110, 120, 90], severity: 'moderate', clusterId: 1, sourceId: 's1', spread: 'LINEAR' },
  { id: 5, x: 400, y: 270, latOffset: 0.0029, lonOffset: -0.0001, lat: 0, lon: 0, tds: 350, turbidity: 1.8, nitrate: 18.5, temp: 25.5, level: 405, rgb: [100, 150, 80], severity: 'moderate', clusterId: 2, sourceId: 's2', spread: 'DIFFUSE' },
  { id: 6, x: 450, y: 250, latOffset: 0.0024, lonOffset: 0.0006, lat: 0, lon: 0, tds: 420, turbidity: 2.4, nitrate: 32.0, temp: 26.8, level: 395, rgb: [90, 170, 60], severity: 'high', clusterId: 2, sourceId: 's2', spread: 'DIFFUSE' },
  { id: 7, x: 520, y: 220, latOffset: 0.0016, lonOffset: 0.0019, lat: 0, lon: 0, tds: 310, turbidity: 1.5, nitrate: 14.0, temp: 25.0, level: 415, rgb: [95, 135, 88], severity: 'moderate', clusterId: 2, sourceId: 's2', spread: 'LINEAR' },
  { id: 8, x: 600, y: 220, latOffset: 0.0009, lonOffset: 0.0032, lat: 0, lon: 0, tds: 480, turbidity: 3.5, nitrate: 15.2, temp: 28.5, level: 370, rgb: [140, 100, 80], severity: 'high', clusterId: 3, sourceId: 's3', spread: 'CONCENTRATED' },
  { id: 9, x: 660, y: 240, latOffset: 0.0004, lonOffset: 0.0042, lat: 0, lon: 0, tds: 550, turbidity: 4.0, nitrate: 18.8, temp: 30.0, level: 360, rgb: [155, 85, 65], severity: 'high', clusterId: 3, sourceId: 's3', spread: 'CONCENTRATED' },
  { id: 10, x: 730, y: 280, latOffset: -0.0004, lonOffset: 0.0052, lat: 0, lon: 0, tds: 340, turbidity: 1.9, nitrate: 10.5, temp: 26.2, level: 400, rgb: [105, 125, 92], severity: 'moderate', clusterId: 3, sourceId: 's3', spread: 'LINEAR' },
  { id: 11, x: 820, y: 290, latOffset: -0.0011, lonOffset: 0.0064, lat: 0, lon: 0, tds: 290, turbidity: 1.3, nitrate: 7.2, temp: 24.8, level: 425, rgb: [85, 140, 105], severity: 'low', clusterId: -1, sourceId: null, spread: 'DIFFUSE' },
  { id: 12, x: 880, y: 260, latOffset: -0.0018, lonOffset: 0.0074, lat: 0, lon: 0, tds: 460, turbidity: 2.8, nitrate: 20.5, temp: 29.0, level: 375, rgb: [150, 95, 75], severity: 'high', clusterId: 4, sourceId: 's4', spread: 'DIFFUSE' },
  { id: 13, x: 940, y: 240, latOffset: -0.0026, lonOffset: 0.0086, lat: 0, lon: 0, tds: 390, turbidity: 2.2, nitrate: 16.0, temp: 27.5, level: 390, rgb: [130, 110, 85], severity: 'moderate', clusterId: 4, sourceId: 's4', spread: 'LINEAR' },
  { id: 14, x: 1020, y: 245, latOffset: -0.0034, lonOffset: 0.0099, lat: 0, lon: 0, tds: 260, turbidity: 1.1, nitrate: 4.5, temp: 23.5, level: 430, rgb: [75, 145, 110], severity: 'low', clusterId: -1, sourceId: null, spread: 'DIFFUSE' },
]

// Dynamically updates sensor coordinates relative to the dynamic base coordinates
subscribeToLocation((lat, lon) => {
  SENSOR_POINTS.forEach(p => {
    p.lat = lat + p.latOffset;
    p.lon = lon + p.lonOffset;
  });
});

/* 48-hour time series (hourly data points) */
function generateTimeSeries() {
  const series = []
  const now = Date.now()
  for (let h = 48; h >= 0; h--) {
    const t = now - h * 3600000
    const progress = (48 - h) / 48
    series.push({
      time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      hour: 48 - h,
      timestamp: t,
      nitrate: 8 + 20 * Math.sin(progress * Math.PI * 1.5) + (Math.random() - 0.5) * 4,
      temperature: 24 + 6 * Math.sin(progress * Math.PI) + (Math.random() - 0.5) * 1.5,
      greenChannel: 80 + 60 * Math.sin(progress * Math.PI * 1.3) + (Math.random() - 0.5) * 10,
      tds: 300 + 250 * Math.sin(progress * Math.PI * 1.2) + (Math.random() - 0.5) * 30,
      turbidity: 1.5 + 2.5 * Math.sin(progress * Math.PI * 1.1) + (Math.random() - 0.5) * 0.3,
    })
  }
  return series
}

/* Pollution fingerprint data for radar chart */
const FINGERPRINTS = [
  { param: 'Nitrate', Factory: 40, Farm: 95, Sewage: 60, Landfill: 30 },
  { param: 'TDS', Factory: 85, Farm: 45, Sewage: 70, Landfill: 55 },
  { param: 'Turbidity', Factory: 70, Farm: 50, Sewage: 80, Landfill: 40 },
  { param: 'Heavy Metals', Factory: 95, Farm: 15, Sewage: 25, Landfill: 80 },
  { param: 'Pathogens', Factory: 10, Farm: 30, Sewage: 95, Landfill: 45 },
]

/* Bar chart data */
const BAR_DATA = [
  { param: 'Nitrate', Factory: 35, Farm: 88, Sewage: 55, Landfill: 25 },
  { param: 'TDS', Factory: 78, Farm: 40, Sewage: 65, Landfill: 50 },
  { param: 'Turbidity', Factory: 65, Farm: 45, Sewage: 75, Landfill: 35 },
  { param: 'Heavy Metals', Factory: 90, Farm: 12, Sewage: 20, Landfill: 72 },
  { param: 'Pathogens', Factory: 8, Farm: 25, Sewage: 92, Landfill: 38 },
]

const TIME_SERIES = generateTimeSeries()

export { SOURCES, RIVER_PATH, SENSOR_POINTS, TIME_SERIES, FINGERPRINTS, BAR_DATA }
