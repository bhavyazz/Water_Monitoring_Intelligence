import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from 'react-leaflet'
import { fetchBatchAnalysis } from '../api'
import 'leaflet/dist/leaflet.css'

const RVCE_CENTER = [12.9240, 77.4990]

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
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions, { padding: [40, 40], maxZoom: 15 })
  }, [positions.length])
  return null
}

function SourceBars({ scores }) {
  if (!scores) return null
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1])
  return (
    <div style={{ marginTop: 6 }}>
      {entries.map(([label, score]) => (
        <div key={label} className="source-bar-row">
          <span className="source-bar-label">{label}</span>
          <div className="source-bar-track">
            <div className="source-bar-fill" style={{ width: `${score * 100}%`, background: sourceColors[label] || 'var(--accent)' }} />
          </div>
          <span className="source-bar-value">{(score * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  )
}

export default function ClusterIntelligence() {
  const [batch, setBatch] = useState(null)
  const [tab, setTab] = useState(0)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const load = () => fetchBatchAnalysis().then(setBatch).catch(() => {})
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [])

  const scored = batch?.scored_samples || []
  const hotspots = batch?.hotspots || []
  const cleanClusters = batch?.clean_clusters || []
  const anomalies = (batch?.anomalies || []).filter(a => a.center)
  const clusters = useMemo(() => [...hotspots, ...cleanClusters], [batch])

  const membersOf = (c) => (c.member_ids || []).map(id => scored.find(s => s.id === id)).filter(Boolean)
  const sourceOf = (c) => batch?.source_attributions?.[c.cluster_id]
  const spreadOf = (c) => batch?.spread_estimates?.[c.cluster_id]
  const nameOf = (c) => {
    const m = membersOf(c)[0]
    if (m?.label) { const d = m.label.indexOf('—'); return d > 0 ? m.label.slice(0, d).trim() : m.label.slice(0, 32) }
    return sourceOf(c)?.source ? `${sourceOf(c).source} cluster` : `Cluster ${c.cluster_id}`
  }

  const sel = clusters.find(c => c.cluster_id === selected) || clusters[0]
  const allPos = scored.filter(s => s.lat && s.lon).map(s => [s.lat, s.lon])

  const TABS = ['Atlas', 'Anatomy', 'Comparison']

  if (!batch) return <div className="loading">Loading cluster analysis...</div>

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Cluster Intelligence — {clusters.length} clusters</h2>
        <p>DBSCAN clusters from {scored.length} field samples (Vrishabhavathy) — real members, source attribution &amp; spread</p>
      </div>

      {/* Status strip — all real */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { l: 'Samples', v: batch?.summary?.total_samples || 0 },
          { l: 'Confirmed hotspots', v: hotspots.length, c: hotspots.length ? '#ff2233' : '#333' },
          { l: 'Clean clusters', v: cleanClusters.length, c: '#44cc66' },
          { l: 'Anomalies', v: anomalies.length, c: anomalies.length ? '#ff6644' : '#333' },
        ].map(s => (
          <div key={s.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.l}</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.c || 'var(--text-secondary)' }}>{s.v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {TABS.map((t, i) => <button key={t} className={`filter-btn${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>)}
      </div>

      {/* ── Atlas ── */}
      {tab === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, height: 'calc(100vh - 320px)' }}>
          <div className="map-container" style={{ height: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <MapContainer center={RVCE_CENTER} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {allPos.length > 0 && <FitBounds positions={allPos} />}
              {clusters.map(c => {
                const isHot = hotspots.includes(c)
                const col = isHot ? '#ff2233' : '#44cc66'
                return (
                  <Circle key={`z${c.cluster_id}`} center={[c.center[0], c.center[1]]} radius={Math.max(150, c.spatial_extent_m || 150)}
                    pathOptions={{ color: col, fillColor: col, fillOpacity: selected === c.cluster_id ? 0.2 : 0.07, weight: selected === c.cluster_id ? 2.5 : 1.5, dashArray: '6 4' }}
                    eventHandlers={{ click: () => { setSelected(c.cluster_id); setTab(1) } }}>
                    <Popup><div><strong>{nameOf(c)}</strong><br />WQS {(c.mean_wqs * 100).toFixed(0)}% · {c.member_count} samples<br />{sourceOf(c)?.source || ''}</div></Popup>
                  </Circle>
                )
              })}
              {scored.filter(s => s.lat && s.lon).map((s, i) => (
                <CircleMarker key={i} center={[s.lat, s.lon]} radius={5} pathOptions={{ fillColor: wqsColor(s.classification), fillOpacity: 0.85, color: '#000', weight: 1 }}>
                  <Popup><div><strong>{s.label || s.id}</strong><br />WQS {(s.wqs * 100).toFixed(0)}% · TDS {s.tds} · Turb {s.turbidity} · pH {s.ph}</div></Popup>
                </CircleMarker>
              ))}
              {anomalies.map(a => (
                <CircleMarker key={`a${a.cluster_id}`} center={[a.center[0], a.center[1]]} radius={7} pathOptions={{ fillColor: '#ff6644', fillOpacity: 0.8, color: '#fff', weight: 2 }}>
                  <Popup><div><strong>{a.classification?.replace(/_/g, ' ')}</strong><br />{a.reasoning}</div></Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clusters.map(c => (
              <div key={c.cluster_id} onClick={() => { setSelected(c.cluster_id); setTab(1) }}
                style={{ background: 'var(--bg-card)', border: `1px solid ${selected === c.cluster_id ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: 12, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{nameOf(c)}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: wqsColor(hotspots.includes(c) ? 'POLLUTED' : 'CLEAN') }}>{(c.mean_wqs * 100).toFixed(0)}%</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{(c.member_ids || []).join(', ')}</div>
                {sourceOf(c) && <div style={{ fontSize: 10, color: sourceColors[sourceOf(c).source] || 'var(--text-muted)', marginTop: 3 }}>{sourceOf(c).source}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Anatomy ── */}
      {tab === 1 && sel && (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
            {clusters.map(c => (
              <button key={c.cluster_id} className={`filter-btn${sel.cluster_id === c.cluster_id ? ' active' : ''}`} onClick={() => setSelected(c.cluster_id)}>{nameOf(c)}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Members */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Member Samples ({membersOf(sel).length})</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{['ID', 'TDS', 'Turb', 'pH', 'WQS'].map(h => <th key={h} style={{ padding: '4px 6px', textAlign: 'left', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {membersOf(sel).map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{m.id}</td>
                      <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{m.tds}</td>
                      <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{m.turbidity}</td>
                      <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{m.ph}</td>
                      <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)', color: wqsColor(m.classification) }}>{(m.wqs * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[['Mean WQS', `${(sel.mean_wqs * 100).toFixed(0)}%`], ['Max WQS', `${(sel.max_wqs * 100).toFixed(0)}%`], ['Extent', `${sel.spatial_extent_m?.toFixed(0) || 0}m`]].map(([l, v]) => (
                  <div key={l}><div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{v}</div></div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>{sel.reasoning}</div>
            </div>

            {/* Source + spread */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sourceOf(sel) && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Source Attribution</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: sourceColors[sourceOf(sel).source] || 'var(--accent)' }}>
                    {sourceOf(sel).source}{sourceOf(sel).ambiguous && <span style={{ color: '#d4a017', fontSize: 10, marginLeft: 6 }}>AMBIGUOUS</span>}
                  </div>
                  <SourceBars scores={sourceOf(sel).scores} />
                  {sourceOf(sel).chemical_evidence?.slice(0, 3).map((e, i) => <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>• {e}</div>)}
                </div>
              )}
              {spreadOf(sel)?.predictions && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Downstream Spread</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {spreadOf(sel).predictions.slice(0, 6).map((p, i) => (
                      <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '4px 8px', fontSize: 9 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{p.distance_m}m</span>
                        <span style={{ color: wqsColor(p.classification), fontWeight: 600, marginLeft: 4 }}>{(p.predicted_wqs * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                  {spreadOf(sel).safe_distance_m && <div style={{ fontSize: 11, color: '#44cc66', fontWeight: 600, marginTop: 8 }}>Safe distance: {spreadOf(sel).safe_distance_m}m</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Comparison ── */}
      {tab === 2 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{['Cluster', 'Type', 'Members', 'Mean WQS', 'Max WQS', 'Extent', 'Source', 'Safe Dist'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
            <tbody>
              {clusters.map(c => (
                <tr key={c.cluster_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{nameOf(c)}</td>
                  <td style={{ padding: '6px 8px' }}><span style={{ fontSize: 10, color: hotspots.includes(c) ? '#ff2233' : '#44cc66' }}>{hotspots.includes(c) ? 'Hotspot' : 'Clean'}</span></td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{c.member_count}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: wqsColor(hotspots.includes(c) ? 'POLLUTED' : 'CLEAN') }}>{(c.mean_wqs * 100).toFixed(0)}%</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{(c.max_wqs * 100).toFixed(0)}%</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{c.spatial_extent_m?.toFixed(0) || 0}m</td>
                  <td style={{ padding: '6px 8px', color: sourceColors[sourceOf(c)?.source] || 'var(--text-muted)' }}>{sourceOf(c)?.source || '—'}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: '#44cc66' }}>{spreadOf(c)?.safe_distance_m ? `${spreadOf(c).safe_distance_m}m` : (hotspots.includes(c) ? '>2km' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
