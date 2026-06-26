import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, useMap } from 'react-leaflet'
import { fetchBatchAnalysis, fetchLatest, postLiveAnalysis } from '../api'
import 'leaflet/dist/leaflet.css'

const RVCE_CENTER = [12.9240, 77.4990]

const wqsColor = (cls) => {
  if (cls === 'SEVERELY_POLLUTED') return '#ff2233'
  if (cls === 'POLLUTED') return '#ff6644'
  if (cls === 'MODERATE') return '#ffaa00'
  return '#44cc66'
}

const wqsLabel = (cls) => {
  if (cls === 'SEVERELY_POLLUTED') return 'Severe'
  if (cls === 'POLLUTED') return 'Polluted'
  if (cls === 'MODERATE') return 'Moderate'
  return 'Clean'
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

function WQSGauge({ wqs, size = 120 }) {
  const color = wqs >= 0.65 ? '#ff2233' : wqs >= 0.40 ? '#ff6644' : wqs >= 0.15 ? '#ffaa00' : '#44cc66'
  const pct = Math.min(100, wqs * 100)
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
        <svg width={size} height={size} viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${pct * 3.27} 327`} strokeLinecap="round"
            transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 0.8s ease' }} />
        </svg>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{(wqs * 100).toFixed(0)}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>WQS</div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'var(--text-secondary)' }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 100 }}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function zoneName(cluster, samples, sourceAttrib) {
  const members = (cluster.member_ids || [])
    .map(id => samples.find(s => s.id === id))
    .filter(Boolean)
  if (members.length > 0) {
    const first = members[0]
    const name = first.label || first.id
    const dash = name.indexOf('—')
    if (dash > 0) return name.substring(0, dash).trim()
    return name.length > 35 ? name.substring(0, 35) + '...' : name
  }
  if (sourceAttrib?.source) return sourceAttrib.source + ' Zone'
  return `Zone ${cluster.cluster_id}`
}

function Badge({ type }) {
  const cls = type?.toLowerCase().replace(/ /g, '_')
  const colorMap = {
    confirmed_hotspot: '#ff2233',
    severe_anomaly: '#ff4455',
    moderate_anomaly: '#ffaa00',
    elevated_cluster: '#ffaa00',
    clean_cluster: '#44cc66',
    clean: '#44cc66',
    moderate: '#ffaa00',
    polluted: '#ff6644',
    severely_polluted: '#ff2233',
  }
  const c = colorMap[cls] || 'var(--text-muted)'
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--font-mono)', background: `${c}18`, color: c }}>
      {type?.replace(/_/g, ' ')}
    </span>
  )
}

// ── Tab 1: Sample Map ─────────────────────────────────────────
function SampleMapTab({ batch }) {
  const samples = batch?.scored_samples || []
  const hotspots = batch?.hotspots || []
  const anomalies = batch?.anomalies || []
  const cleanClusters = batch?.clean_clusters || []
  const summary = batch?.summary || {}
  const [selected, setSelected] = useState(null)

  const allPositions = samples.filter(s => s.lat && s.lon).map(s => [s.lat, s.lon])

  const allClusters = [...hotspots, ...anomalies, ...cleanClusters]

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total Samples" value={summary.total_samples || 0} />
        <StatCard label="Clean" value={summary.clean || 0} color="#44cc66" />
        <StatCard label="Moderate" value={summary.moderate || 0} color="#ffaa00" />
        <StatCard label="Polluted" value={summary.polluted || 0} color="#ff6644" />
        <StatCard label="Severe" value={summary.severely_polluted || 0} color="#ff2233" />
        <StatCard label="Hotspots" value={summary.confirmed_hotspots || 0} color="#ff2233" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, height: 'calc(100vh - 340px)' }}>
        <div className="map-container" style={{ height: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <MapContainer center={RVCE_CENTER} zoom={14} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {allPositions.length > 0 && <FitBounds positions={allPositions} />}

            {hotspots.map(h => {
              const src = batch?.source_attributions?.[h.cluster_id]
              const hName = zoneName(h, samples, src)
              return (
                <Circle key={`hz-${h.cluster_id}`}
                  center={[h.center[0], h.center[1]]}
                  radius={Math.max(200, h.spatial_extent_m || 200)}
                  pathOptions={{ color: '#ff2233', fillColor: '#ff2233', fillOpacity: selected === h.cluster_id ? 0.2 : 0.08, weight: selected === h.cluster_id ? 2.5 : 1.5, dashArray: '6 4' }}
                  eventHandlers={{ click: () => setSelected(h.cluster_id) }}>
                  <Popup><div><strong>{hName}</strong><br/>{src?.source && <span>Source: {src.source}<br/></span>}WQS: {(h.mean_wqs * 100).toFixed(0)}% — {h.member_ids?.join(', ')}<br/><em style={{fontSize: 11}}>{h.reasoning}</em></div></Popup>
                </Circle>
              )
            })}

            {cleanClusters.map(c => (
              <Circle key={`cz-${c.cluster_id}`}
                center={[c.center[0], c.center[1]]}
                radius={Math.max(150, c.spatial_extent_m || 150)}
                pathOptions={{ color: '#44cc66', fillColor: '#44cc66', fillOpacity: 0.06, weight: 1, dashArray: '4 4' }}>
                <Popup><div><strong>Clean Zone</strong><br/>{c.reasoning}</div></Popup>
              </Circle>
            ))}

            {samples.filter(s => s.lat && s.lon).map((s, i) => (
              <CircleMarker key={`s-${i}`} center={[s.lat, s.lon]} radius={5}
                pathOptions={{ fillColor: wqsColor(s.classification), fillOpacity: 0.85, color: '#000', weight: 1 }}>
                <Popup>
                  <div>
                    <strong>{s.label || s.id}</strong><br/>
                    WQS: {(s.wqs * 100).toFixed(1)} — {wqsLabel(s.classification)}<br/>
                    TDS: {s.tds} | Turb: {s.turbidity} | pH: {s.ph}<br/>
                    Limiting: {s.limiting_parameter}<br/>
                    {s.notes && <em style={{ fontSize: 10 }}>{s.notes}</em>}
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {anomalies.filter(a => a.center).map(a => (
              <CircleMarker key={`an-${a.cluster_id}`} center={[a.center[0], a.center[1]]} radius={7}
                pathOptions={{ fillColor: '#ff6644', fillOpacity: 0.8, color: '#fff', weight: 2 }}>
                <Popup><div><strong>{a.classification?.replace(/_/g, ' ')}</strong><br/>{a.reasoning}</div></Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Detected Zones ({allClusters.length})
          </div>

          {allClusters.map(c => {
            const sourceAttrib = batch?.source_attributions?.[c.cluster_id]
            const spreadEst = batch?.spread_estimates?.[c.cluster_id]
            const name = zoneName(c, samples, sourceAttrib)
            return (
              <div key={c.cluster_id}
                onClick={() => setSelected(selected === c.cluster_id ? null : c.cluster_id)}
                style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${selected === c.cluster_id ? 'var(--border-light)' : 'var(--border)'}`,
                  borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'border-color 0.2s',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' }}>{name}</span>
                  <Badge type={c.classification} />
                </div>
                {c.member_ids && (
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                    Samples: {c.member_ids.join(', ')}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 6 }}>{c.reasoning}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {[
                    ['WQS', `${(c.mean_wqs * 100).toFixed(0)}%`],
                    ['Extent', `${c.spatial_extent_m?.toFixed(0) || 0}m`],
                    ['Samples', c.member_count],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {sourceAttrib && (
                  <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Source Attribution</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {sourceAttrib.source}
                      {sourceAttrib.ambiguous && <span style={{ color: '#ffaa00', fontSize: 10, marginLeft: 6 }}>⚠ AMBIGUOUS</span>}
                    </div>
                    {sourceAttrib.chemical_evidence?.slice(0, 2).map((e, i) => (
                      <div key={i} style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>• {e}</div>
                    ))}
                  </div>
                )}
                {spreadEst?.predictions && (
                  <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-muted)' }}>
                    Safe distance: {spreadEst.safe_distance_m ? `${spreadEst.safe_distance_m}m` : '>2km'}
                  </div>
                )}
              </div>
            )
          })}

          {allClusters.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading analysis...</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Live Reading Analysis ──────────────────────────────
function LiveReadingTab({ batch }) {
  const [reading, setReading] = useState(null)
  const [liveResult, setLiveResult] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const poll = () => fetchLatest().then(d => {
      const r = d?.reading
      if (r) setReading(r)
    }).catch(() => {})
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!reading || !reading.tds) return
    setLoading(true)
    postLiveAnalysis({
      tds: reading.tds,
      turbidity: reading.turbidity || 0,
      ph: reading.ph || 7.0,
      temperature: reading.temperature || 25.0,
      lat: reading.latitude,
      lon: reading.longitude,
    }).then(r => {
      setLiveResult(r)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [reading?.tds, reading?.latitude])

  if (!reading) return <div className="loading">Waiting for live sensor data...</div>

  const wqs = liveResult?.wqs || {}
  const hotspot = liveResult?.hotspot_status || {}
  const source = liveResult?.source || {}
  const spread = liveResult?.spread || {}
  const verdict = liveResult?.verdict || {}

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span className="live-dot" />
        <span style={{ fontSize: 11, color: 'var(--safe)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Live</span>
        {reading.latitude && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>GPS: {reading.latitude?.toFixed(4)}, {reading.longitude?.toFixed(4)}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <WQSGauge wqs={wqs.wqs || 0} />
          <div style={{ fontSize: 13, fontWeight: 600, color: wqsColor(wqs.classification || 'CLEAN') }}>{wqsLabel(wqs.classification || 'CLEAN')}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Verdict */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16,
            borderLeft: `4px solid ${verdict.action?.includes('SAFE') ? '#44cc66' : verdict.action?.includes('CAUTION') ? '#ffaa00' : '#ff2233'}`,
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Verdict</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: verdict.action?.includes('SAFE') ? '#44cc66' : verdict.action?.includes('CAUTION') ? '#ffaa00' : '#ff2233', marginBottom: 6 }}>
              {verdict.action || '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{verdict.detail}</div>
          </div>

          {/* Hotspot Status */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Hotspot Status</div>
            <Badge type={hotspot.status || 'UNKNOWN'} />
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>{hotspot.reasoning}</div>
            {hotspot.nearby_count > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                {hotspot.nearby_count} nearby readings, {hotspot.nearby_polluted} polluted
              </div>
            )}
          </div>

          {/* Source */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Likely Source</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {source.source || '—'}
              {source.ambiguous && <span style={{ color: '#ffaa00', fontSize: 10, marginLeft: 6 }}>AMBIGUOUS</span>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{source.description}</div>
            {/* Confidence bar */}
            {source.confidence > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>Confidence</div>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${source.confidence * 100}%`, background: source.confidence > 0.5 ? '#44cc66' : '#ffaa00', borderRadius: 2, transition: 'width 0.4s' }} />
                </div>
              </div>
            )}
            {source.chemical_evidence?.slice(0, 2).map((e, i) => (
              <div key={i} style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>• {e}</div>
            ))}
            {source.osm_features_found?.length > 0 && (
              <div style={{ fontSize: 9, color: '#2090b0', marginTop: 4 }}>
                OSM: {source.osm_features_found.map(f => f.tag).join(', ')}
              </div>
            )}
            {!source.proximity_available && source.source && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>Chemical-only (OSM unavailable)</div>
            )}
          </div>

          {/* Sensor readings */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Parameters</div>
            {[
              ['TDS', reading.tds, 'ppm', wqs.parameter_scores?.tds],
              ['Turbidity', reading.turbidity, 'NTU', wqs.parameter_scores?.turbidity],
              ['pH', reading.ph?.toFixed(1), '', wqs.parameter_scores?.ph],
              ['Temperature', reading.temperature?.toFixed(1), '°C', wqs.parameter_scores?.temperature],
            ].map(([label, val, unit, exc]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{val} {unit}</span>
                  {exc > 0 && <span style={{ fontSize: 9, color: '#ff6644', fontFamily: 'var(--font-mono)' }}>+{(exc * 100).toFixed(0)}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spread prediction */}
      {spread?.predictions && spread.spread_needed && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Downstream Spread Prediction
            {spread.water_body && spread.water_body !== 'unknown' && (
              <span style={{ color: '#2090b0', marginLeft: 8, textTransform: 'none' }}>via {spread.water_body}</span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: reading.latitude ? '1fr 1fr' : '1fr', gap: 16 }}>
            {reading.latitude && spread.downstream_path?.length > 0 && (
              <div style={{ height: 200, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <MapContainer center={[reading.latitude, reading.longitude]} zoom={14} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <CircleMarker center={[reading.latitude, reading.longitude]} radius={6}
                    pathOptions={{ fillColor: '#ff2233', fillOpacity: 0.9, color: '#fff', weight: 2 }} />
                  {spread.predictions.filter(p => p.downstream_lat).map((p, i) => (
                    <CircleMarker key={i} center={[p.downstream_lat, p.downstream_lon]} radius={4}
                      pathOptions={{ fillColor: wqsColor(p.classification), fillOpacity: 0.7, color: '#000', weight: 0.5 }}>
                      <Popup><div>{p.distance_m}m — WQS {(p.predicted_wqs * 100).toFixed(0)}% — {p.classification}</div></Popup>
                    </CircleMarker>
                  ))}
                  {spread.downstream_path.length > 1 && (
                    <Polyline positions={spread.downstream_path} pathOptions={{ color: '#2090b0', weight: 2, opacity: 0.5, dashArray: '6 4' }} />
                  )}
                </MapContainer>
              </div>
            )}

            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Distance', 'Travel', 'WQS', 'Status'].map(h => (
                      <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {spread.predictions.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{p.distance_m}m</td>
                      <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{p.travel_time_min}min</td>
                      <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', color: wqsColor(p.classification) }}>{(p.predicted_wqs * 100).toFixed(1)}%</td>
                      <td style={{ padding: '4px 8px' }}><Badge type={p.classification} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {spread.safe_distance_m && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#44cc66', fontWeight: 600 }}>
                  Estimated safe distance: {spread.safe_distance_m}m downstream
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.3 }}>Parameter Sources</div>
            {spread.assumptions}
          </div>
          {spread.methodology_note && (
            <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {spread.methodology_note}
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>Analyzing...</div>}
    </div>
  )
}

// ── Tab 3: Batch Analysis Report ──────────────────────────────
function BatchReportTab({ batch }) {
  const summary = batch?.summary || {}
  const hotspots = batch?.hotspots || []
  const anomalies = batch?.anomalies || []
  const scored = batch?.scored_samples || []
  const [expanded, setExpanded] = useState(null)

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aquavision-analysis-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {summary.total_samples || 0} samples analyzed — Vrishabhavathy River validation dataset
        </div>
        <button className="action-btn" onClick={exportJSON} style={{ fontSize: 11, padding: '6px 14px' }}>
          Export JSON
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Total" value={summary.total_samples || 0} />
        <StatCard label="Clean" value={summary.clean || 0} color="#44cc66" />
        <StatCard label="Moderate" value={summary.moderate || 0} color="#ffaa00" />
        <StatCard label="Polluted" value={summary.polluted || 0} color="#ff6644" />
        <StatCard label="Severe" value={summary.severely_polluted || 0} color="#ff2233" />
        <StatCard label="Hotspots" value={summary.confirmed_hotspots || 0} color="#ff2233" />
        <StatCard label="Anomalies" value={summary.anomalies || 0} color="#ff6644" />
      </div>

      {/* Hotspot cards */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Confirmed Hotspots ({hotspots.length})
      </div>
      {hotspots.map(h => {
        const src = batch?.source_attributions?.[h.cluster_id]
        const spr = batch?.spread_estimates?.[h.cluster_id]
        const isExpanded = expanded === h.cluster_id
        const memberSamples = scored.filter(s => h.member_ids?.includes(s.id))
        const hName = zoneName(h, scored, src)

        return (
          <div key={h.cluster_id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: 16, marginBottom: 12, cursor: 'pointer',
          }} onClick={() => setExpanded(isExpanded ? null : h.cluster_id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>{hName}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>{h.member_count} samples, {h.spatial_extent_m?.toFixed(0)}m radius</span>
              </div>
              <Badge type={h.severity} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              {h.member_ids?.join(', ')} {src?.source && <span>— {src.source}</span>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>{h.reasoning}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <div><div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Mean WQS</div><div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#ff6644' }}>{(h.mean_wqs * 100).toFixed(1)}%</div></div>
              <div><div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Max WQS</div><div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#ff2233' }}>{(h.max_wqs * 100).toFixed(1)}%</div></div>
              <div><div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Source</div><div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{src?.source || '—'}</div></div>
              <div><div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Safe Dist</div><div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#44cc66' }}>{spr?.safe_distance_m ? `${spr.safe_distance_m}m` : '>2km'}</div></div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {src && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Source Attribution Detail</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{src.description}</div>
                    {src.chemical_evidence?.map((e, i) => (
                      <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>• {e}</div>
                    ))}
                    {src.ambiguous && <div style={{ fontSize: 10, color: '#ffaa00', marginTop: 4 }}>{src.ambiguity_note}</div>}
                  </div>
                )}

                {memberSamples.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Member Samples</div>
                    {memberSamples.map(s => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 10 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{s.id} — {s.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: wqsColor(s.classification) }}>{(s.wqs * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {spr?.predictions && (
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Spread Prediction</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {spr.predictions.slice(0, 5).map((p, i) => (
                        <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '4px 8px', fontSize: 9 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{p.distance_m}m</span>
                          <span style={{ color: wqsColor(p.classification), fontWeight: 600, marginLeft: 4 }}>{(p.predicted_wqs * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 600 }}>Sources: </span>{spr.assumptions}
                    </div>
                    {spr.methodology_note && (
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>{spr.methodology_note}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {anomalies.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 }}>
            Anomalies ({anomalies.length})
          </div>
          {anomalies.map(a => (
            <div key={a.cluster_id} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              padding: 12, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Badge type={a.classification} />
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: wqsColor(a.mean_wqs >= 0.40 ? 'POLLUTED' : 'MODERATE') }}>
                  WQS {(a.mean_wqs * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a.reasoning}</div>
            </div>
          ))}
        </>
      )}

      {/* Full samples table */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 }}>
        All Samples ({scored.length})
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['ID', 'Label', 'TDS', 'Turb', 'pH', 'Temp', 'WQS', 'Status', 'Limiting', 'Drinking', 'Bathing'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scored.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.id}</td>
                <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</td>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.tds}</td>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.turbidity}</td>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.ph}</td>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.temperature}</td>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: wqsColor(s.classification) }}>{(s.wqs * 100).toFixed(1)}%</td>
                <td style={{ padding: '5px 8px' }}><Badge type={s.classification} /></td>
                <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--text-muted)' }}>{s.limiting_parameter}</td>
                <td style={{ padding: '5px 8px', fontSize: 10, color: s.safe_for_drinking?.safe ? '#44cc66' : '#ff4455' }}>{s.safe_for_drinking?.safe ? 'Yes' : 'No'}</td>
                <td style={{ padding: '5px 8px', fontSize: 10, color: s.safe_for_bathing?.safe ? '#44cc66' : '#ff4455' }}>{s.safe_for_bathing?.safe ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function FieldAnalysis() {
  const [tab, setTab] = useState(0)
  const [batch, setBatch] = useState(null)

  useEffect(() => {
    fetchBatchAnalysis().then(setBatch).catch(() => {})
  }, [])

  const tabs = ['Sample Map', 'Live Analysis', 'Batch Report']

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Field Analysis</h2>
        <p>Location-agnostic water quality assessment — validated on Vrishabhavathy River, RVCE Bangalore</p>
      </div>

      {/* Method box */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 24, alignItems: 'center' }}>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>WQS Engine</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>BIS 10500</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Hotspot</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>DBSCAN 400m</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Source ID</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>Chemical + OSM</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Spread</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>1D ADE</div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>v=0.4 D=5 k=0.23/d</div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16, marginLeft: 8, flex: 1, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          BIS 10500 exceedance scoring → DBSCAN hotspot detection → chemical + OSM source attribution → Fischer ADE spread model.
          Spread params from BWSSB discharge data, Fischer (1975) dispersion formula, Metcalf & Eddy decay rates.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {tabs.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className="filter-btn" style={tab === i ? { color: 'var(--text-primary)', background: 'var(--bg-card-hover)', borderColor: 'var(--accent)' } : {}}>
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <SampleMapTab batch={batch} />}
      {tab === 1 && <LiveReadingTab batch={batch} />}
      {tab === 2 && <BatchReportTab batch={batch} />}
    </div>
  )
}
