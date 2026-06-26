import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from 'react-leaflet'
import { fetchAnalysis, postHistoricalSample } from '../api'
import useLiveLocation from '../hooks/useLiveLocation'
import 'leaflet/dist/leaflet.css'

const RVCE_CENTER = [12.9240, 77.4990]

const severityColor = (sev) => {
  if (sev === 'HIGH') return '#ff4444'
  if (sev === 'MODERATE') return '#ffaa00'
  return '#44cc66'
}

const qualityColor = (label) => {
  if (label === 'Unsafe') return '#ff4455'
  if (label === 'Moderate') return '#ffaa00'
  return '#44cc66'
}

const wqsColor = (cls) => {
  if (cls === 'SEVERELY_POLLUTED') return '#ff2233'
  if (cls === 'POLLUTED') return '#ff6644'
  if (cls === 'MODERATE') return '#ffaa00'
  return '#44cc66'
}

const sourceColors = {
  'Industrial Discharge': '#e74c3c',
  'Sewage Contamination': '#8B4513',
  'Agricultural Runoff': '#27ae60',
  'Solid Waste Leachate': '#7f8c8d',
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

function ConfidenceBar({ value, color, delay = 0 }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(value * 100), delay + 50)
    return () => clearTimeout(t)
  }, [value, delay])
  return (
    <div className="confidence-bar-track">
      <div className="confidence-bar-fill" style={{ width: `${width}%`, background: color }} />
    </div>
  )
}

function SourceBars({ scores, animated }) {
  if (!scores) return null
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [show, setShow] = useState(!animated)
  useEffect(() => {
    if (animated) { const t = setTimeout(() => setShow(true), 100); return () => clearTimeout(t) }
  }, [animated])
  return (
    <div style={{ marginTop: 8 }}>
      {entries.map(([label, score], i) => (
        <div key={label} className="source-bar-row">
          <span className="source-bar-label">{label}</span>
          <div className="source-bar-track">
            <div className="source-bar-fill"
              style={{
                width: show ? `${score * 100}%` : '0%',
                background: sourceColors[label] || 'var(--accent)',
                transitionDelay: `${i * 80}ms`,
              }} />
          </div>
          <span className="source-bar-value">{(score * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  )
}

// ── Analysis Panel (slides in from right) ────────────────────────
function AnalysisPanel({ sample, analysis, loading, onClose }) {
  const open = !!sample

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const src = analysis?.source
  const spr = analysis?.spread
  const wqs = analysis?.wqs

  return (
    <div className={`analysis-panel ${open ? 'open' : ''}`}>
      <button className="panel-close" onClick={onClose}>✕</button>

      {sample && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, paddingRight: 32 }}>
            {sample.location_name || sample.sample_id || 'Sample'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 16 }}>
            {sample.latitude?.toFixed(5)}, {sample.longitude?.toFixed(5)}
          </div>

          {/* Parameters */}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Parameters</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              ['TDS', sample.tds, 'ppm', '#2090b0'],
              ['Turbidity', sample.turbidity, 'NTU', '#888'],
              ['pH', sample.ph?.toFixed(1), '', '#6c5ce7'],
            ].map(([label, val, unit, color]) => (
              <div key={label} style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{val}</div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label} {unit}</div>
              </div>
            ))}
          </div>

          {/* WQS */}
          {wqs && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: wqsColor(wqs.classification) }}>
                  {(wqs.wqs * 100).toFixed(0)}%
                </span>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                  background: `${wqsColor(wqs.classification)}18`,
                  color: wqsColor(wqs.classification),
                }}>
                  {wqs.classification?.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="skeleton" style={{ width: '100%', height: 12, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '80%', height: 12, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '60%', height: 12 }} />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>Analyzing sample...</div>
            </div>
          )}

          {/* Source Identification */}
          {src && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Source Identification (Chemical)
              </div>
              <div style={{
                padding: '8px 12px', borderRadius: 8,
                background: `${sourceColors[src.source] || 'var(--accent)'}10`,
                borderLeft: `3px solid ${sourceColors[src.source] || 'var(--accent)'}`,
                marginBottom: 8,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: sourceColors[src.source] || 'var(--accent)' }}>
                  {src.source}
                  {src.ambiguous && <span style={{ color: '#ffaa00', fontSize: 10, marginLeft: 6 }}>AMBIGUOUS</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{src.description}</div>
              </div>

              <SourceBars scores={src.scores} animated={true} />

              {src.chemical_evidence?.map((e, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>• {e}</div>
              ))}
            </div>
          )}

          {/* Spread Estimation */}
          {spr && spr.spread_needed && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Spread Estimation
                {analysis?.water_body?.name && (
                  <span style={{ color: '#2090b0', marginLeft: 6, textTransform: 'none' }}>
                    via {analysis.water_body.name}
                  </span>
                )}
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginBottom: 8 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Dist', 'Time', 'WQS', 'Status'].map(h => (
                      <th key={h} style={{ padding: '3px 6px', textAlign: 'left', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {spr.predictions?.slice(0, 7).map((p, i) => (
                    <tr key={i} className="stagger-in" style={{ borderBottom: '1px solid var(--border)', animationDelay: `${i * 60}ms` }}>
                      <td style={{ padding: '3px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{p.distance_m}m</td>
                      <td style={{ padding: '3px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{p.travel_time_min}m</td>
                      <td style={{ padding: '3px 6px', fontFamily: 'var(--font-mono)', color: wqsColor(p.classification) }}>{(p.predicted_wqs * 100).toFixed(1)}%</td>
                      <td style={{ padding: '3px 6px', fontSize: 9, color: wqsColor(p.classification), fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {p.classification?.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {spr.safe_distance_m && (
                <div style={{ fontSize: 11, color: '#44cc66', fontWeight: 600 }}>
                  Safe distance: {spr.safe_distance_m}m
                </div>
              )}

              <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {spr.assumptions}
              </div>
            </div>
          )}

          {spr && !spr.spread_needed && (
            <div style={{ fontSize: 11, color: 'var(--safe)', fontWeight: 600, marginTop: 8 }}>
              WQS below threshold — no significant contamination to model.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function HotspotDetection() {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [selectedSample, setSelectedSample] = useState(null)
  const [sampleAnalysis, setSampleAnalysis] = useState(null)
  const [panelLoading, setPanelLoading] = useState(false)
  const [clusterStagger, setClusterStagger] = useState(0)
  const livePos = useLiveLocation()

  useEffect(() => {
    const load = () => fetchAnalysis().then(d => {
      setData(d)
    }).catch(() => {})
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  // Stagger cluster cards on mount
  useEffect(() => {
    if (data?.clusters?.length > 0 && clusterStagger === 0) {
      data.clusters.forEach((_, i) => {
        setTimeout(() => setClusterStagger(i + 1), i * 80)
      })
    }
  }, [data?.clusters?.length])

  // Handle sample click — trigger analysis
  const handleSampleClick = useCallback(async (sample) => {
    setSelectedSample(sample)
    setSampleAnalysis(null)
    setPanelLoading(true)

    try {
      const result = await postHistoricalSample({
        sample_id: sample.sample_id,
        lat: sample.latitude,
        lon: sample.longitude,
        tds: sample.tds || 0,
        turbidity: sample.turbidity || 0,
        ph: sample.ph || 7.0,
      })
      setSampleAnalysis(result)
    } catch {
      setSampleAnalysis(null)
    } finally {
      setPanelLoading(false)
    }
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedSample(null)
    setSampleAnalysis(null)
  }, [])

  const clusters = data?.clusters || []
  const samples = data?.samples || []
  const noise = data?.noise_samples || []
  const summary = data?.summary || {}

  const allPositions = samples
    .filter(s => s.latitude && s.longitude)
    .map(s => [s.latitude, s.longitude])

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Hotspot Detection</h2>
        <p>DBSCAN spatial clustering identifies pollution hotspots from {summary.total_samples || 0} field samples — click any sample for analysis</p>
      </div>

      {/* Method box */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 24, alignItems: 'center' }}>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Algorithm</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>DBSCAN</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Epsilon</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>800m</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Min Samples</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>3</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Metric</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>Haversine</div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16, marginLeft: 8, flex: 1, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Samples within 800m of each other are grouped. A cluster needs at least 3 samples.
          Click any marker to view source identification and spread analysis.
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total Samples', value: summary.total_samples || 0, color: 'var(--text-secondary)' },
          { label: 'Clusters Found', value: clusters.length, color: '#ff6644' },
          { label: 'Clustered', value: (summary.total_samples || 0) - (summary.noise_points || 0), color: '#2090b0' },
          { label: 'Noise / Isolated', value: summary.noise_points || 0, color: 'var(--text-secondary)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, height: 'calc(100vh - 340px)' }}>
        {/* Map */}
        <div className="map-container" style={{ height: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <MapContainer center={RVCE_CENTER} zoom={14} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {allPositions.length > 0 && <FitBounds positions={allPositions} />}

            {/* Cluster zones */}
            {clusters.map(c => (
              <Circle key={`zone-${c.cluster_id}`}
                center={[c.center[0], c.center[1]]}
                radius={c.affected_radius_m || 200}
                pathOptions={{
                  color: severityColor(c.severity),
                  fillColor: severityColor(c.severity),
                  fillOpacity: selected === c.cluster_id ? 0.2 : 0.08,
                  weight: selected === c.cluster_id ? 2.5 : 1.5,
                  dashArray: '6 4',
                }}
                eventHandlers={{ click: () => setSelected(c.cluster_id) }}>
                <Popup>
                  <div>
                    <strong>{c.cluster_name}</strong><br />
                    Severity: {c.severity} | Samples: {c.reading_count}<br />
                    Avg WQI: {c.avg_wqi} | Source: {c.pollution_source}
                  </div>
                </Popup>
              </Circle>
            ))}

            {/* Cluster center markers */}
            {clusters.map(c => (
              <CircleMarker key={`cc-${c.cluster_id}`}
                center={[c.center[0], c.center[1]]}
                radius={8}
                pathOptions={{
                  fillColor: severityColor(c.severity),
                  fillOpacity: 0.9,
                  color: selected === c.cluster_id ? '#fff' : '#000',
                  weight: selected === c.cluster_id ? 3 : 2,
                }}
                eventHandlers={{ click: () => setSelected(c.cluster_id) }}
              />
            ))}

            {/* Individual sample markers — clickable for analysis */}
            {samples.filter(s => s.latitude && s.longitude).map((s, i) => (
              <CircleMarker key={`s-${i}`} center={[s.latitude, s.longitude]} radius={4}
                pathOptions={{
                  fillColor: qualityColor(s.quality_label),
                  fillOpacity: selectedSample?.sample_id === s.sample_id ? 1 : 0.7,
                  color: selectedSample?.sample_id === s.sample_id ? '#fff' : '#000',
                  weight: selectedSample?.sample_id === s.sample_id ? 2.5 : 0.5,
                }}
                eventHandlers={{ click: () => handleSampleClick(s) }}>
                <Popup>
                  <div>
                    <strong>{s.location_name || s.sample_id}</strong><br />
                    TDS: {s.tds} | Turb: {s.turbidity} | pH: {s.ph}<br />
                    WQI: {s.contamination_score?.toFixed(1)} | {s.quality_label}<br />
                    <em style={{ fontSize: 10 }}>Click marker to analyze</em>
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* Noise point markers */}
            {noise.map((s, i) => (
              <CircleMarker key={`n-${i}`} center={[s.latitude, s.longitude]} radius={4}
                pathOptions={{
                  fillColor: '#555',
                  fillOpacity: 0.6,
                  color: 'var(--text-muted)',
                  weight: 1,
                  dashArray: '3 3',
                }}
                eventHandlers={{ click: () => handleSampleClick(s) }}>
                <Popup>
                  <div>
                    <strong>{s.location_name || s.sample_id}</strong> (Noise)<br />
                    TDS: {s.tds} | Turb: {s.turbidity} | pH: {s.ph}<br />
                    WQI: {s.contamination_score?.toFixed(1)} | {s.quality_label}<br />
                    <em style={{ fontSize: 10 }}>Click to analyze</em>
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* Selected sample highlight ring */}
            {selectedSample?.latitude && (
              <CircleMarker center={[selectedSample.latitude, selectedSample.longitude]} radius={16}
                pathOptions={{ fillColor: 'transparent', fillOpacity: 0, color: 'var(--accent)', weight: 2.5, dashArray: '4 4' }} />
            )}

            {/* Live sensor position */}
            {livePos && (
              <CircleMarker center={[livePos.lat, livePos.lon]} radius={8}
                pathOptions={{ fillColor: 'var(--bg-card)', fillOpacity: 0.9, color: 'var(--text-primary)', weight: 2 }}>
                <Popup>
                  <div>
                    <strong>Live Sensor</strong><br />
                    TDS: {livePos.tds} | Turb: {livePos.turbidity} | pH: {livePos.ph?.toFixed(1)}<br />
                    WQI: {livePos.wqi?.toFixed(1)} | {livePos.quality}
                  </div>
                </Popup>
              </CircleMarker>
            )}
          </MapContainer>
        </div>

        {/* Side panel — cluster list */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Detected Hotspots
          </div>

          {clusters.map((c, idx) => (
            <div key={c.cluster_id}
              className="stagger-in"
              style={{
                background: 'var(--bg-card)',
                border: `1px solid ${selected === c.cluster_id ? severityColor(c.severity) : severityColor(c.severity) + '25'}`,
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                transition: 'border-color 0.2s',
                animationDelay: `${idx * 80}ms`,
                opacity: idx < clusterStagger ? 1 : 0,
              }}
              onClick={() => setSelected(selected === c.cluster_id ? null : c.cluster_id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>{c.cluster_name}</span>
                <span className={`badge badge-${c.severity?.toLowerCase()}`}>{c.severity}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
                {c.reading_count} samples within {c.affected_radius_m || 200}m radius
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {[
                  ['WQI', c.avg_wqi, c.avg_wqi >= 60 ? '#ff4455' : c.avg_wqi >= 30 ? '#ffaa00' : '#44cc66'],
                  ['TDS', `${c.avg_tds}`, '#888'],
                  ['pH', c.avg_ph, '#888'],
                ].map(([l, v, col]) => (
                  <div key={l}>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: col }}>{v}</div>
                  </div>
                ))}
              </div>
              {c.sample_locations?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-secondary)' }}>
                  Locations: {c.sample_locations.slice(0, 3).join(', ')}{c.sample_locations.length > 3 ? ` +${c.sample_locations.length - 3}` : ''}
                </div>
              )}
            </div>
          ))}

          {/* Noise points section */}
          {noise.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 }}>
                Noise / Isolated ({noise.length})
              </div>
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 12,
                fontSize: 10,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}>
                <div style={{ marginBottom: 6, color: 'var(--text-muted)' }}>
                  These {noise.length} samples are too far ({'>'}800m) from any cluster of 3+ samples:
                </div>
                {noise.map((s, i) => (
                  <div key={i}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => handleSampleClick(s)}>
                    <span style={{ color: 'var(--text-secondary)' }}>{s.location_name || s.sample_id}</span>
                    <span style={{ color: qualityColor(s.quality_label), fontFamily: 'var(--font-mono)' }}>{s.quality_label}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Click any sample to view source identification and spread analysis.
                </div>
              </div>
            </>
          )}

          {clusters.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading analysis...</div>}
        </div>
      </div>

      {/* ── Sliding Analysis Panel ── */}
      <AnalysisPanel
        sample={selectedSample}
        analysis={sampleAnalysis}
        loading={panelLoading}
        onClose={handleClosePanel}
      />
    </div>
  )
}
