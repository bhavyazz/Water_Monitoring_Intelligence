import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from 'react-leaflet'
import { fetchClusters, fetchHistory } from '../api'
import { useActiveLocation } from '../locationProvider'
import 'leaflet/dist/leaflet.css'

/* Auto-fit map bounds when data changes */
function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40], maxZoom: 16 })
    }
  }, [positions, map])
  return null
}

export default function MapView() {
  const [clusters, setClusters] = useState(null)
  const [readings, setReadings] = useState([])

  useEffect(() => {
    const load = () => {
      fetchClusters().then(setClusters)
      fetchHistory(100).then(d => setReadings(d?.readings || []))
    }
    load()
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
  }, [])

  /* Collect all valid positions for auto-fit */
  const positions = readings
    .filter(r => r.latitude && r.longitude)
    .map(r => [r.latitude, r.longitude])

  const latestGPS = readings.find(r => r.latitude && r.longitude)
  const [baseLat, baseLon, locationSource] = useActiveLocation(latestGPS?.latitude, latestGPS?.longitude)
  const defaultCenter = [baseLat, baseLon]

  const severityColor = (sev) => {
    if (sev === 'HIGH') return '#ff4444'
    if (sev === 'MODERATE') return '#ffaa00'
    return '#44cc66'
  }

  return (
    <>
      <div className="page-header">
        <h2>Map</h2>
        <p>Sensor locations and pollution hotspot clusters [Source: {locationSource}]</p>
      </div>

      <div className="map-container">
        <MapContainer
          key={`${baseLat}-${baseLon}`}
          center={defaultCenter}
          zoom={15}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {positions.length > 0 && <FitBounds positions={positions} />}

          {/* Individual reading markers */}
          {readings
            .filter(r => r.latitude && r.longitude)
            .map((r, i) => (
              <CircleMarker
                key={`r-${i}`}
                center={[r.latitude, r.longitude]}
                radius={3}
                pathOptions={{
                  fillColor: '#ffffff',
                  fillOpacity: 0.4,
                  color: '#ffffff',
                  weight: 0.5,
                  opacity: 0.3,
                }}
              >
                <Popup>
                  <div>
                    <strong>Reading</strong><br />
                    TDS: {r.tds?.toFixed(0)} ppm<br />
                    Turbidity: {r.turbidity?.toFixed(2)} NTU<br />
                    Nitrate: {r.nitrate?.toFixed(2)} ppm<br />
                    Quality: {r.quality_label}<br />
                    Time: {new Date(r.timestamp).toLocaleTimeString()}
                  </div>
                </Popup>
              </CircleMarker>
            ))}

          {/* Cluster zones */}
          {clusters?.clusters?.map(c => (
            <Circle
              key={`c-${c.cluster_id}`}
              center={[c.center[0], c.center[1]]}
              radius={parseFloat(c.affected_radius) || 50}
              pathOptions={{
                color: severityColor(c.severity),
                fillColor: severityColor(c.severity),
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: '6 4',
              }}
            >
              <Popup>
                <div>
                  <strong>Cluster {c.cluster_id}</strong><br />
                  Severity: {c.severity}<br />
                  Source: {c.probable_source}<br />
                  Direction: {c.spread_direction}<br />
                  Speed: {c.spread_speed}<br />
                  Radius: {c.affected_radius}<br />
                  Readings: {c.reading_count}
                </div>
              </Popup>
            </Circle>
          ))}

          {/* Cluster center markers */}
          {clusters?.clusters?.map(c => (
            <CircleMarker
              key={`cc-${c.cluster_id}`}
              center={[c.center[0], c.center[1]]}
              radius={6}
              pathOptions={{
                fillColor: severityColor(c.severity),
                fillOpacity: 0.9,
                color: '#000',
                weight: 1.5,
              }}
            />
          ))}
        </MapContainer>
      </div>

      {/* Cluster legend */}
      {clusters?.clusters?.length > 0 && (
        <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 11, color: '#555' }}>
          {clusters.clusters.map(c => (
            <span key={c.cluster_id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: severityColor(c.severity), display: 'inline-block'
              }} />
              Cluster {c.cluster_id} — {c.severity}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
