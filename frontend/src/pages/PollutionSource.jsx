import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from 'react-leaflet'
import { fetchClusters } from '../api'
import { useActiveLocation } from '../locationProvider'
import 'leaflet/dist/leaflet.css'

const SOURCE_COLORS = {
  'Industrial Discharge': '#ff4444',
  'Sewage Contamination': '#ffaa00',
  'Agricultural Runoff': '#44cc66',
  'Unknown': '#888888',
}

function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions, { padding: [40, 40], maxZoom: 16 })
  }, [positions, map])
  return null
}

export default function PollutionSource() {
  const [data, setData] = useState(null)

  useEffect(() => {
    const load = () => fetchClusters().then(setData)
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  const clusters = data?.clusters || []
  const positions = clusters.map(c => [c.center[0], c.center[1]])
  const [baseLat, baseLon, locationSource] = useActiveLocation()
  const defaultCenter = [baseLat, baseLon]

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Pollution Sources</h2>
        <p>Identified contamination sources based on location and land use analysis [Source: {locationSource}]</p>
      </div>

      <div className="map-split">
        <div className="map-container">
          <MapContainer key={`${baseLat}-${baseLon}`} center={defaultCenter} zoom={15} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; OSM &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {positions.length > 0 && <FitBounds positions={positions} />}

            {clusters.map(c => {
              const color = SOURCE_COLORS[c.probable_source] || '#888'
              return (
                <Circle key={`zone-${c.cluster_id}`}
                  center={[c.center[0], c.center[1]]}
                  radius={parseFloat(c.affected_radius) || 50}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 1.5, dashArray: '6 4' }}
                >
                  <Popup>
                    <div>
                      <strong>Cluster {c.cluster_id}</strong><br />
                      Source: {c.probable_source}<br />
                      Severity: {c.severity}<br />
                      Radius: {c.affected_radius}<br />
                      Readings: {c.reading_count}
                    </div>
                  </Popup>
                </Circle>
              )
            })}

            {clusters.map(c => {
              const color = SOURCE_COLORS[c.probable_source] || '#888'
              return (
                <CircleMarker key={`center-${c.cluster_id}`}
                  center={[c.center[0], c.center[1]]}
                  radius={8}
                  pathOptions={{ fillColor: color, fillOpacity: 0.9, color: '#000', weight: 2 }}
                >
                  <Popup>
                    <div>
                      <strong>{c.probable_source}</strong><br />
                      Severity: {c.severity}<br />
                      Direction: {c.spread_direction}<br />
                      Speed: {c.spread_speed}
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>
        </div>

        {/* Side panel with cluster details */}
        <div className="map-sidebar-panel">
          <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
            {clusters.length} source{clusters.length !== 1 ? 's' : ''} detected
          </div>

          {clusters.map(c => (
            <div className="cluster-card" key={c.cluster_id}>
              <div className="cluster-header">
                <span className="cluster-id">Cluster {c.cluster_id}</span>
                <span className={`badge badge-${c.severity?.toLowerCase()}`}>{c.severity}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: SOURCE_COLORS[c.probable_source] || '#888', marginBottom: 12 }}>
                {c.probable_source}
              </div>
              <div className="cluster-detail-grid">
                <div className="cluster-detail">
                  <div className="label">Radius</div>
                  <div className="value">{c.affected_radius}</div>
                </div>
                <div className="cluster-detail">
                  <div className="label">Readings</div>
                  <div className="value">{c.reading_count}</div>
                </div>
                <div className="cluster-detail">
                  <div className="label">Center</div>
                  <div className="value">{c.center[0]?.toFixed(4)}, {c.center[1]?.toFixed(4)}</div>
                </div>
                <div className="cluster-detail">
                  <div className="label">Direction</div>
                  <div className="value">{c.spread_direction}</div>
                </div>
              </div>
            </div>
          ))}

          {clusters.length === 0 && <div className="empty-state">No clusters detected yet</div>}

          {/* Legend */}
          <div className="source-legend" style={{ marginTop: 'auto', padding: '8px 0' }}>
            {Object.entries(SOURCE_COLORS).map(([name, color]) => (
              <div className="source-legend-item" key={name}>
                <span className="source-legend-dot" style={{ background: color }} />
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
