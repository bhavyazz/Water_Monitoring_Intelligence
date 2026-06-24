import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet'
import { fetchClusters, fetchHistory } from '../api'
import { useActiveLocation } from '../locationProvider'
import 'leaflet/dist/leaflet.css'

/* Direction string to bearing degrees for arrow rendering */
const DIR_BEARING = {
  'North': 0, 'North-East': 45, 'East': 90, 'South-East': 135,
  'South': 180, 'South-West': 225, 'West': 270, 'North-West': 315,
}

/* Compute an arrow endpoint from center given bearing and distance */
function arrowEndpoint(lat, lon, bearingDeg, distKm) {
  const R = 6371
  const d = distKm / R
  const brng = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng))
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI]
}

function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions, { padding: [40, 40], maxZoom: 16 })
  }, [positions, map])
  return null
}

const severityColor = (s) => s === 'HIGH' ? '#ff4455' : s === 'MODERATE' ? '#ffaa00' : '#44cc66'

export default function PollutionSpread() {
  const [data, setData] = useState(null)
  const [readings, setReadings] = useState([])
  const [playbackIdx, setPlaybackIdx] = useState(null)

  useEffect(() => {
    const load = () => {
      fetchClusters().then(setData)
      fetchHistory(200).then(d => setReadings(d?.readings || []))
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  /* Playback animation: show readings one by one */
  useEffect(() => {
    if (playbackIdx === null) return
    if (playbackIdx >= readings.length) { setPlaybackIdx(null); return }
    const t = setTimeout(() => setPlaybackIdx(i => i + 1), 80)
    return () => clearTimeout(t)
  }, [playbackIdx, readings.length])

  const clusters = data?.clusters || []
  const positions = clusters.map(c => [c.center[0], c.center[1]])
  const latestGPS = readings.find(r => r.latitude && r.longitude)
  const [baseLat, baseLon, locationSource] = useActiveLocation(latestGPS?.latitude, latestGPS?.longitude)
  const defaultCenter = [baseLat, baseLon]

  const visibleReadings = playbackIdx !== null ? readings.slice(0, playbackIdx) : readings

  /* Build arrow lines for each cluster */
  const arrows = useMemo(() => clusters.map(c => {
    const bearing = DIR_BEARING[c.spread_direction] ?? null
    if (bearing === null || !c.center) return null
    const end = arrowEndpoint(c.center[0], c.center[1], bearing, 0.08)
    return { id: c.cluster_id, start: [c.center[0], c.center[1]], end, color: severityColor(c.severity) }
  }).filter(Boolean), [clusters])

  return (
    <div className="page-fade">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>Pollution Spread</h2>
          {playbackIdx !== null && <span className="live-indicator"><span className="live-dot" /> Replaying</span>}
        </div>
        <p>Track cluster movement direction and speed over time [Source: {locationSource}]</p>
      </div>

      <div className="filter-bar">
        <button className="filter-btn" onClick={() => setPlaybackIdx(0)}>
          Replay Spread Animation
        </button>
        {playbackIdx !== null && (
          <span style={{ fontSize: 11, color: '#555' }}>
            {playbackIdx} / {readings.length} readings
          </span>
        )}
      </div>

      <div className="map-container" style={{ height: 'calc(100vh - 240px)' }}>
        <MapContainer key={`${baseLat}-${baseLon}`} center={defaultCenter} zoom={15} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OSM &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {positions.length > 0 && <FitBounds positions={positions} />}

          {/* Reading dots (with playback support) */}
          {visibleReadings.filter(r => r.latitude && r.longitude).map((r, i) => (
            <CircleMarker key={`r-${i}`} center={[r.latitude, r.longitude]} radius={2.5}
              pathOptions={{ fillColor: '#fff', fillOpacity: 0.3, color: '#fff', weight: 0.3, opacity: 0.2 }} />
          ))}

          {/* Cluster zones */}
          {clusters.map(c => (
            <Circle key={`z-${c.cluster_id}`} center={[c.center[0], c.center[1]]}
              radius={parseFloat(c.affected_radius) || 50}
              pathOptions={{
                color: severityColor(c.severity), fillColor: severityColor(c.severity),
                fillOpacity: 0.08, weight: 1.5, dashArray: '8 4'
              }}>
              <Popup>
                <div>
                  <strong>Cluster {c.cluster_id}</strong><br />
                  Direction: {c.spread_direction}<br />
                  Speed: {c.spread_speed}<br />
                  Severity: {c.severity}<br />
                  Radius: {c.affected_radius}
                </div>
              </Popup>
            </Circle>
          ))}

          {/* Cluster center */}
          {clusters.map(c => (
            <CircleMarker key={`cc-${c.cluster_id}`} center={[c.center[0], c.center[1]]} radius={5}
              pathOptions={{ fillColor: severityColor(c.severity), fillOpacity: 1, color: '#000', weight: 1.5 }} />
          ))}

          {/* Direction arrows */}
          {arrows.map(a => (
            <Polyline key={`arrow-${a.id}`} positions={[a.start, a.end]}
              pathOptions={{ color: a.color, weight: 3, opacity: 0.8, dashArray: '2 6' }}>
              <Popup><div>Spread direction arrow for Cluster {a.id}</div></Popup>
            </Polyline>
          ))}

          {/* Arrow heads */}
          {arrows.map(a => (
            <CircleMarker key={`ah-${a.id}`} center={a.end} radius={4}
              pathOptions={{ fillColor: a.color, fillOpacity: 1, color: a.color, weight: 2 }} />
          ))}
        </MapContainer>
      </div>

      {/* Spread info cards */}
      <div className="spread-info-panel">
        {clusters.map(c => (
          <div className="spread-info-card" key={c.cluster_id}>
            <div className="label">Cluster {c.cluster_id}</div>
            <div className="value" style={{ color: severityColor(c.severity) }}>{c.spread_direction || 'N/A'}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
              Speed: {c.spread_speed || 'N/A'} | Radius: {c.affected_radius}
            </div>
          </div>
        ))}
        {clusters.length === 0 && <div className="empty-state" style={{ padding: 20 }}>Waiting for cluster data</div>}
      </div>
    </div>
  )
}
