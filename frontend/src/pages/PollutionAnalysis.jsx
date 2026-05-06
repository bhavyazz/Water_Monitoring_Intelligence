import { useState, useEffect, useMemo } from 'react'
import { fetchClusters } from '../api'
import { SOURCES, RIVER_PATH, SENSOR_POINTS, FINGERPRINTS, BAR_DATA } from '../data/syntheticData'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
         RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts'

const SEV_COLOR = { high: '#ff4455', moderate: '#ffaa00', low: '#44cc66' }
const SRC_COLORS = { Factory: '#ff4455', Farm: '#44cc66', Sewage: '#ffaa00', Landfill: '#bb66ff' }
const TABS = ['River Map', 'Source Details', 'Fingerprint Analysis']

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.fill || p.stroke }}>{p.name}: {p.value}</div>)}
    </div>
  )
}

/* Inline SVG source icon */
function SourceSVG({ type, x, y }) {
  const s = 16
  const col = SRC_COLORS[type] || '#888'
  return (
    <g transform={`translate(${x - s}, ${y - s})`}>
      <rect width={s * 2} height={s * 2} rx="5" fill="#0a0e1a" stroke={col} strokeWidth="1.2" />
      {type === 'Factory' && <path d="M8,26 V14 L13,18 V14 L18,18 V10 H24 V26 Z" fill="none" stroke={col} strokeWidth="1.1" />}
      {type === 'Farm' && <path d="M16,8 C16,8 22,12 22,18 M16,8 C16,8 10,12 10,18 M16,8 V26 M8,26 H24" fill="none" stroke={col} strokeWidth="1.1" />}
      {type === 'Sewage' && <><circle cx="16" cy="14" r="5" fill="none" stroke={col} strokeWidth="1.1" /><path d="M11,22 H21 M13,25 H19" fill="none" stroke={col} strokeWidth="1" /></>}
      {type === 'Landfill' && <path d="M9,26 L12,12 H20 L23,26 Z M13,16 H19 M12,20 H20" fill="none" stroke={col} strokeWidth="1.1" />}
    </g>
  )
}

export default function PollutionAnalysis() {
  const [tab, setTab] = useState(0)
  const [selected, setSelected] = useState(null)
  const [tick, setTick] = useState(0)
  const [clusters, setClusters] = useState([])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 50)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetchClusters().then(d => setClusters(d?.clusters || []))
    const id = setInterval(() => fetchClusters().then(d => setClusters(d?.clusters || [])), 15000)
    return () => clearInterval(id)
  }, [])

  const sel = selected !== null ? SENSOR_POINTS.find(p => p.id === selected) : null
  const selSrc = sel?.sourceId ? SOURCES.find(s => s.id === sel.sourceId) : null

  /* Count severity stats */
  const stats = useMemo(() => {
    const s = { high: 0, moderate: 0, low: 0 }
    SENSOR_POINTS.forEach(p => s[p.severity]++)
    return s
  }, [])

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Pollution Analysis</h2>
        <p>Source identification, river contamination mapping, and waste fingerprinting</p>
      </div>

      {/* Quick stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Sensor Points', value: SENSOR_POINTS.length, color: '#ccc' },
          { label: 'Critical', value: stats.high, color: '#ff4455' },
          { label: 'Warning', value: stats.moderate, color: '#ffaa00' },
          { label: 'Normal', value: stats.low, color: '#44cc66' },
          { label: 'Live Clusters', value: clusters.length, color: '#2090b0' },
        ].map(s => (
          <div key={s.label} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        {TABS.map((t, i) => (
          <button key={t} className={`filter-btn${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* ═══════ TAB 0: River Map ═══════ */}
      {tab === 0 && (
        <div className="page-fade" style={{ display: 'flex', gap: 16, height: 'calc(100vh - 300px)' }}>
          <div style={{ flex: 1, background: '#080c18', borderRadius: 12, border: '1px solid #1a1a2e', overflow: 'hidden' }}>
            <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="rg" x1="0%" y1="0%" x2="100%"><stop offset="0%" stopColor="#0a3d5c" /><stop offset="100%" stopColor="#0e5a7e" /></linearGradient>
                <filter id="gl"><feGaussianBlur stdDeviation="3" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <radialGradient id="pH"><stop offset="0%" stopColor="#ff4455" stopOpacity="0.35" /><stop offset="100%" stopColor="#ff4455" stopOpacity="0" /></radialGradient>
                <radialGradient id="pM"><stop offset="0%" stopColor="#ffaa00" stopOpacity="0.25" /><stop offset="100%" stopColor="#ffaa00" stopOpacity="0" /></radialGradient>
              </defs>
              {/* River layers */}
              <path d={RIVER_PATH} fill="none" stroke="url(#rg)" strokeWidth="28" strokeLinecap="round" opacity="0.5" />
              <path d={RIVER_PATH} fill="none" stroke="#1a6a8a" strokeWidth="14" strokeLinecap="round" opacity="0.6" />
              <path d={RIVER_PATH} fill="none" stroke="#30b0d0" strokeWidth="1.5" opacity="0.35" strokeDasharray="8 20" strokeDashoffset={-tick * 2} />
              {/* Plumes */}
              {SENSOR_POINTS.filter(p => p.severity !== 'low').map(p => {
                const r = p.spread === 'CONCENTRATED' ? 22 : p.spread === 'LINEAR' ? 16 : 30
                return <ellipse key={`pl${p.id}`} cx={p.x + (p.spread === 'LINEAR' ? 12 : 0)} cy={p.y}
                  rx={p.spread === 'LINEAR' ? r * 2.2 : r} ry={r}
                  fill={p.severity === 'high' ? 'url(#pH)' : 'url(#pM)'}
                  opacity={0.5 + 0.2 * Math.sin(tick * 0.04 + p.id)} />
              })}
              {/* Connection lines */}
              {SENSOR_POINTS.filter(p => p.sourceId).map(p => {
                const src = SOURCES.find(s => s.id === p.sourceId)
                return src && <line key={`ln${p.id}`} x1={p.x} y1={p.y} x2={src.x} y2={src.y}
                  stroke={src.color} strokeWidth="1" opacity="0.35" strokeDasharray="5 4" strokeDashoffset={-tick * 1.2} />
              })}
              {/* Sources */}
              {SOURCES.map(s => (
                <g key={s.id}>
                  <SourceSVG type={s.type} x={s.x} y={s.y} />
                  <text x={s.x} y={s.y + 26} textAnchor="middle" fill="#555" fontSize="8" fontFamily="Inter">{s.label}</text>
                </g>
              ))}
              {/* Points */}
              {SENSOR_POINTS.map(p => {
                const c = SEV_COLOR[p.severity]
                const pr = 7 + 3 * Math.sin(tick * 0.06 + p.id * 0.5)
                const isSel = selected === p.id
                return (
                  <g key={`sp${p.id}`} onClick={() => setSelected(p.id)} style={{ cursor: 'pointer' }}>
                    <circle cx={p.x} cy={p.y} r={pr + 5} fill={c} opacity={isSel ? 0.25 : 0.1} />
                    <circle cx={p.x} cy={p.y} r={pr} fill={c} opacity={0.2} />
                    <circle cx={p.x} cy={p.y} r={isSel ? 6 : 4.5} fill={c} stroke={isSel ? '#fff' : '#080c18'} strokeWidth={isSel ? 2 : 1.5} filter="url(#gl)" />
                  </g>
                )
              })}
            </svg>
          </div>
          {/* Detail panel */}
          <div style={{ width: 280, minWidth: 280, overflowY: 'auto' }}>
            {sel ? (
              <div className="page-fade" key={sel.id} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>#{sel.id}</span>
                  <span className={`badge badge-${sel.severity}`}>{sel.severity.toUpperCase()}</span>
                </div>
                {[['GPS', `${sel.lat.toFixed(6)}, ${sel.lon.toFixed(6)}`], ['TDS', `${sel.tds} ppm`], ['Turbidity', `${sel.turbidity} NTU`],
                  ['Nitrate', `${sel.nitrate} ppm`], ['Temperature', `${sel.temp} °C`], ['Water Level', `${sel.level} mm`],
                  ['Cluster', sel.clusterId >= 0 ? `#${sel.clusterId}` : 'Noise'], ['Spread', sel.spread],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #151a28', fontSize: 11 }}>
                    <span style={{ color: '#444' }}>{l}</span><span style={{ color: '#aaa', fontFamily: 'var(--font-mono)' }}>{v}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <span style={{ fontSize: 10, color: '#444' }}>RGB</span>
                  <div style={{ width: 32, height: 16, borderRadius: 3, background: `rgb(${sel.rgb.join(',')})`, border: '1px solid #222' }} />
                  <span style={{ fontSize: 10, color: '#666', fontFamily: 'var(--font-mono)' }}>{sel.rgb.join(', ')}</span>
                </div>
                {selSrc && (
                  <div style={{ marginTop: 14, padding: 10, background: '#0a0e1a', borderRadius: 8, borderLeft: `3px solid ${selSrc.color}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: selSrc.color }}>{selSrc.label}</div>
                    <div style={{ fontSize: 10, color: '#555' }}>{selSrc.type} — linked source</div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: '#2a2a2a', fontSize: 12 }}>Select a point on the map</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB 1: Source Details ═══════ */}
      {tab === 1 && (
        <div className="page-fade" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {SOURCES.map(s => (
            <div key={s.id} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 22, transition: 'border-color 0.3s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = s.color + '50'} onMouseLeave={e => e.currentTarget.style.borderColor = '#1a1a2e'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: 8, background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={s.color} strokeWidth="1.6">
                    {s.type === 'Factory' && <><path d="M5 20V10l4 3V10l4 3V6h4v14" /><path d="M3 20h18" /></>}
                    {s.type === 'Farm' && <path d="M12 3c0 0 5 4 5 9M12 3c0 0-5 4-5 9M12 3v18M5 21h14" />}
                    {s.type === 'Sewage' && <><circle cx="12" cy="10" r="5" /><path d="M7 18h10M9 21h6" /></>}
                    {s.type === 'Landfill' && <><path d="M6 20l3-12h6l3 12" /><path d="M9 12h6M8 16h8" /></>}
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: s.color }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#444' }}>{s.type}</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Waste Products</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {s.waste.map(w => (
                  <span key={w} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: s.color + '12', color: s.color + 'cc', fontFamily: 'var(--font-mono)' }}>{w}</span>
                ))}
              </div>
              {/* Linked readings count */}
              <div style={{ marginTop: 14, fontSize: 11, color: '#555' }}>
                {SENSOR_POINTS.filter(p => p.sourceId === s.id).length} linked sensor readings
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════ TAB 2: Fingerprint ═══════ */}
      {tab === 2 && (
        <div className="page-fade" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
            <h3>Pollution Contribution by Source</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={BAR_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
                <XAxis dataKey="param" tick={{ fill: '#444', fontSize: 10 }} />
                <YAxis tick={{ fill: '#444', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="Factory" fill="#ff4455" radius={[3,3,0,0]} animationDuration={1200} />
                <Bar dataKey="Farm" fill="#44cc66" radius={[3,3,0,0]} animationDuration={1200} />
                <Bar dataKey="Sewage" fill="#ffaa00" radius={[3,3,0,0]} animationDuration={1200} />
                <Bar dataKey="Landfill" fill="#bb66ff" radius={[3,3,0,0]} animationDuration={1200} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
            <h3>Pollution Fingerprint Overlay</h3>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={FINGERPRINTS}>
                <PolarGrid stroke="#1a1a2e" />
                <PolarAngleAxis dataKey="param" tick={{ fill: '#555', fontSize: 10 }} />
                <PolarRadiusAxis tick={{ fill: '#333', fontSize: 9 }} domain={[0, 100]} />
                <Radar name="Factory" dataKey="Factory" stroke="#ff4455" fill="#ff4455" fillOpacity={0.12} strokeWidth={1.5} animationDuration={1200} />
                <Radar name="Farm" dataKey="Farm" stroke="#44cc66" fill="#44cc66" fillOpacity={0.12} strokeWidth={1.5} animationDuration={1200} />
                <Radar name="Sewage" dataKey="Sewage" stroke="#ffaa00" fill="#ffaa00" fillOpacity={0.12} strokeWidth={1.5} animationDuration={1200} />
                <Radar name="Landfill" dataKey="Landfill" stroke="#bb66ff" fill="#bb66ff" fillOpacity={0.12} strokeWidth={1.5} animationDuration={1200} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
