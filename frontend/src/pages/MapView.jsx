import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, useMap } from 'react-leaflet'
import { fetchAnalysis, fetchWaterBodies } from '../api'
import useLiveLocation from '../hooks/useLiveLocation'
import 'leaflet/dist/leaflet.css'

const RVCE_CENTER = [12.9240, 77.4990]

const qualityColor = (label) => {
  if (label === 'Unsafe') return '#ff4455'
  if (label === 'Moderate') return '#ffaa00'
  return '#44cc66'
}

const severityColor = (sev) => {
  if (sev === 'HIGH') return '#ff4444'
  if (sev === 'MODERATE') return '#ffaa00'
  return '#44cc66'
}

function FitBounds({ positions }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40], maxZoom: 15 })
      fitted.current = true
    }
  }, [positions, map])
  return null
}

export default function MapView() {
  const [analysis, setAnalysis] = useState(null)
  const [network, setNetwork] = useState(null)
  const livePos = useLiveLocation()

  useEffect(() => {
    const load = () => {
      fetchAnalysis().then(setAnalysis).catch(() => {})
      fetchWaterBodies().then(setNetwork).catch(() => {})
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  const samples = analysis?.samples || []
  const clusters = analysis?.clusters || []
  const spreadMap = analysis?.spread || {}
  const noise = analysis?.noise_samples || []
  const summary = analysis?.summary || {}
  const bodies = network?.bodies || {}
  const connections = network?.connections || {}

  const positions = samples
    .filter(s => s.latitude && s.longitude)
    .map(s => [s.latitude, s.longitude])

  // Build water body connection lines
  const connectionLines = []
  const visited = new Set()
  Object.entries(connections).forEach(([fromId, targets]) => {
    targets.forEach(t => {
      const key = [fromId, t.id].sort().join('--')
      if (visited.has(key)) return
      visited.add(key)
      const from = bodies[fromId]
      const to = bodies[t.id]
      if (from && to) {
        connectionLines.push({
          key,
          from: [from.latitude, from.longitude],
          to: [to.latitude, to.longitude],
          distance: t.distance_km,
          fromName: from.name,
          toName: to.name,
        })
      }
    })
  })

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Water Monitoring Intelligence</h2>
        <p>Vrushabavathi River, RVCE Bangalore — {summary.total_samples || 0} samples, {summary.hotspots || 0} hotspots, {Object.keys(bodies).length} water bodies</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total Samples', value: summary.total_samples || 0, color: 'var(--text-secondary)' },
          { label: 'Safe', value: summary.safe || 0, color: '#44cc66' },
          { label: 'Moderate', value: summary.moderate || 0, color: '#ffaa00' },
          { label: 'Unsafe', value: summary.unsafe || 0, color: '#ff4455' },
          { label: 'Hotspots', value: summary.hotspots || 0, color: '#ff6644' },
          { label: 'Water Bodies', value: Object.keys(bodies).length, color: '#2090b0' },
          { label: 'Bloom Warnings', value: summary.bloom_warnings || 0, color: '#bb66ff' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        {/* Map */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="map-container" style={{ height: 420, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <MapContainer center={RVCE_CENTER} zoom={14} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
              {positions.length > 0 && <FitBounds positions={positions} />}

              {/* Water body connections */}
              {connectionLines.map(c => (
                <Polyline key={c.key} positions={[c.from, c.to]}
                  pathOptions={{ color: '#2090b0', weight: 1.5, opacity: 0.4, dashArray: '6 4' }}>
                  <Popup><div>{c.fromName} -- {c.toName}<br/>{c.distance} km</div></Popup>
                </Polyline>
              ))}

              {/* Water body markers */}
              {Object.entries(bodies).map(([id, wb]) => (
                <CircleMarker key={`wb-${id}`} center={[wb.latitude, wb.longitude]} radius={5}
                  pathOptions={{ fillColor: '#2090b0', fillOpacity: 0.7, color: 'var(--bg-card)', weight: 1.5 }}>
                  <Popup><div><strong>{wb.name}</strong><br/>Type: {wb.body_type}</div></Popup>
                </CircleMarker>
              ))}

              {/* Sample markers */}
              {samples.filter(s => s.latitude && s.longitude).map((s, i) => (
                <CircleMarker key={`s-${i}`} center={[s.latitude, s.longitude]} radius={4}
                  pathOptions={{
                    fillColor: qualityColor(s.quality_label),
                    fillOpacity: 0.8,
                    color: '#000',
                    weight: 1,
                  }}>
                  <Popup>
                    <div>
                      <strong>{s.location_name || s.sample_id}</strong><br />
                      TDS: {s.tds} ppm | Turb: {s.turbidity} NTU | pH: {s.ph}<br />
                      WQI: {s.contamination_score?.toFixed(1)} | {s.quality_label}<br />
                      Source: {s.pollution_source}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* Cluster zones */}
              {clusters.map(c => (
                <Circle key={`c-${c.cluster_id}`}
                  center={[c.center[0], c.center[1]]}
                  radius={c.affected_radius_m || 200}
                  pathOptions={{
                    color: severityColor(c.severity),
                    fillColor: severityColor(c.severity),
                    fillOpacity: 0.1,
                    weight: 1.5,
                    dashArray: '6 4',
                  }}>
                  <Popup>
                    <div>
                      <strong>{c.cluster_name || `Hotspot ${c.cluster_id}`}</strong><br />
                      Source: {c.pollution_source} ({c.source_confidence})<br />
                      Avg WQI: {c.avg_wqi} | TDS: {c.avg_tds} | pH: {c.avg_ph}<br />
                      Samples: {c.reading_count}
                    </div>
                  </Popup>
                </Circle>
              ))}

              {clusters.map(c => (
                <CircleMarker key={`cc-${c.cluster_id}`}
                  center={[c.center[0], c.center[1]]}
                  radius={7}
                  pathOptions={{ fillColor: severityColor(c.severity), fillOpacity: 0.9, color: '#000', weight: 2 }}>
                </CircleMarker>
              ))}

              {livePos && (
                <CircleMarker center={[livePos.lat, livePos.lon]} radius={8}
                  pathOptions={{ fillColor: 'var(--bg-card)', fillOpacity: 0.9, color: 'var(--text-primary)', weight: 2 }}>
                  <Popup><div><strong>Live Sensor</strong><br />TDS: {livePos.tds} | pH: {livePos.ph?.toFixed(1)} | WQI: {livePos.wqi?.toFixed(1)} | {livePos.quality}</div></Popup>
                </CircleMarker>
              )}
            </MapContainer>
          </div>

          {/* Samples table */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              All Samples ({samples.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['ID', 'Location', 'TDS', 'Turb', 'pH', 'WQI', 'Quality', 'Source'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {samples.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.sample_id}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.location_name}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.tds}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.turbidity}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.ph}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.contamination_score?.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px' }}><span style={{ color: qualityColor(s.quality_label), fontWeight: 600 }}>{s.quality_label}</span></td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', fontSize: 10 }}>{s.pollution_source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right panel: Clusters + Spread + Water Bodies */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 'calc(420px + 300px + 16px)' }}>
          {/* Hotspot clusters */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Hotspot Clusters ({clusters.length})
          </div>
          {clusters.map(c => (
            <div key={c.cluster_id} style={{
              background: 'var(--bg-card)',
              border: `1px solid ${severityColor(c.severity)}25`,
              borderRadius: 10,
              padding: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>{c.cluster_name || `Cluster ${c.cluster_id}`}</span>
                <span className={`badge badge-${c.severity?.toLowerCase()}`}>{c.severity}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: severityColor(c.severity), marginBottom: 6 }}>
                {c.pollution_source} <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)' }}>({c.source_confidence})</span>
              </div>
              {c.source_reasons?.map((r, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '2px 0 2px 8px', borderLeft: `2px solid ${severityColor(c.severity)}30`, marginBottom: 2 }}>
                  {r}
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
                {[
                  ['WQI', c.avg_wqi],
                  ['TDS', `${c.avg_tds}`],
                  ['pH', c.avg_ph],
                  ['Samples', c.reading_count],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Per-cluster spread summary */}
          {Object.keys(spreadMap).length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                Spread Summary (per cluster)
              </div>
              {Object.entries(spreadMap).map(([cid, sp]) => {
                const topRisk = sp.results?.[0]
                return (
                  <div key={cid} style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>{sp.cluster_name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Source: {sp.source_name} (WQI {sp.source_wqi}) → {sp.results?.length || 0} water bodies
                    </div>
                    {topRisk && (
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        Highest downstream risk: {topRisk.water_body_name} ({topRisk.risk_score?.toFixed(1)})
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Water body network */}
          {Object.keys(bodies).length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                Water Body Network ({Object.keys(bodies).length})
              </div>
              {Object.entries(bodies).map(([id, wb]) => (
                <div key={id} style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{wb.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{wb.body_type} | {wb.latitude?.toFixed(4)}, {wb.longitude?.toFixed(4)}</div>
                  </div>
                  <div style={{ fontSize: 9, color: '#2090b0', fontFamily: 'var(--font-mono)' }}>
                    {(connections[id] || []).length} conn
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
