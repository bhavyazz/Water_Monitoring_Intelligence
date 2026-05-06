import { useState, useEffect } from 'react'
import { SOURCES, RIVER_PATH, SENSOR_POINTS } from '../data/syntheticData'

const SEV_COLOR = { high: '#ff4455', moderate: '#ffaa00', low: '#44cc66' }

/* Source type SVG icons */
function SourceIcon({ type, x, y }) {
  const s = 18
  if (type === 'Factory') return (
    <g transform={`translate(${x - s},${y - s})`}>
      <rect width={s * 2} height={s * 2} rx="4" fill="#1a1a2e" stroke="#ff4455" strokeWidth="1.5" />
      <path d="M8,28 V16 L14,20 V16 L20,20 V12 H26 V28 Z" fill="none" stroke="#ff4455" strokeWidth="1.2" />
      <rect x="22" y="6" width="3" height="6" fill="none" stroke="#ff4455" strokeWidth="1" />
    </g>
  )
  if (type === 'Farm') return (
    <g transform={`translate(${x - s},${y - s})`}>
      <rect width={s * 2} height={s * 2} rx="4" fill="#0a1a10" stroke="#44cc66" strokeWidth="1.5" />
      <path d="M18,10 C18,10 24,14 24,20 M18,10 C18,10 12,14 12,20 M18,10 V28 M8,28 H28" fill="none" stroke="#44cc66" strokeWidth="1.2" />
    </g>
  )
  if (type === 'Sewage') return (
    <g transform={`translate(${x - s},${y - s})`}>
      <rect width={s * 2} height={s * 2} rx="4" fill="#1a1508" stroke="#ffaa00" strokeWidth="1.5" />
      <circle cx="18" cy="16" r="6" fill="none" stroke="#ffaa00" strokeWidth="1.2" />
      <path d="M12,24 H24 M14,27 H22" fill="none" stroke="#ffaa00" strokeWidth="1" />
      <path d="M18,10 V6" stroke="#ffaa00" strokeWidth="1" />
    </g>
  )
  return (
    <g transform={`translate(${x - s},${y - s})`}>
      <rect width={s * 2} height={s * 2} rx="4" fill="#15101a" stroke="#bb66ff" strokeWidth="1.5" />
      <path d="M10,28 L14,14 H22 L26,28 Z" fill="none" stroke="#bb66ff" strokeWidth="1.2" />
      <line x1="16" y1="18" x2="20" y2="18" stroke="#bb66ff" strokeWidth="1" />
      <line x1="15" y1="22" x2="21" y2="22" stroke="#bb66ff" strokeWidth="1" />
    </g>
  )
}

export default function RiverSourceMap() {
  const [selected, setSelected] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60)
    return () => clearInterval(id)
  }, [])

  const sel = selected ? SENSOR_POINTS.find(p => p.id === selected) : null
  const selSource = sel?.sourceId ? SOURCES.find(s => s.id === sel.sourceId) : null

  return (
    <div className="page-fade" style={{ display: 'flex', gap: 16, height: 'calc(100vh - 100px)' }}>
      {/* SVG Map */}
      <div style={{ flex: 1, background: '#080c18', borderRadius: 12, border: '1px solid #1a1a2e', overflow: 'hidden', position: 'relative' }}>
        <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
          <defs>
            {/* River gradient */}
            <linearGradient id="riverGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0a3d5c" /><stop offset="100%" stopColor="#0e5a7e" />
            </linearGradient>
            {/* Glow filter */}
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="g" />
              <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Plume gradient for each severity */}
            <radialGradient id="plumeHigh"><stop offset="0%" stopColor="#ff4455" stopOpacity="0.4" /><stop offset="100%" stopColor="#ff4455" stopOpacity="0" /></radialGradient>
            <radialGradient id="plumeMod"><stop offset="0%" stopColor="#ffaa00" stopOpacity="0.3" /><stop offset="100%" stopColor="#ffaa00" stopOpacity="0" /></radialGradient>
            <radialGradient id="plumeLow"><stop offset="0%" stopColor="#44cc66" stopOpacity="0.15" /><stop offset="100%" stopColor="#44cc66" stopOpacity="0" /></radialGradient>
          </defs>

          {/* River */}
          <path d={RIVER_PATH} fill="none" stroke="url(#riverGrad)" strokeWidth="28" strokeLinecap="round" opacity="0.5" />
          <path d={RIVER_PATH} fill="none" stroke="#1a6a8a" strokeWidth="14" strokeLinecap="round" opacity="0.6" />
          <path d={RIVER_PATH} fill="none" stroke="#2090b0" strokeWidth="4" strokeLinecap="round" opacity="0.3" />

          {/* Animated river flow lines */}
          <path d={RIVER_PATH} fill="none" stroke="#30b0d0" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"
            strokeDasharray="8 20" strokeDashoffset={-tick * 2} />

          {/* Connecting lines from sensor to source */}
          {SENSOR_POINTS.filter(p => p.sourceId).map(p => {
            const src = SOURCES.find(s => s.id === p.sourceId)
            if (!src) return null
            return (
              <line key={`line-${p.id}`} x1={p.x} y1={p.y} x2={src.x} y2={src.y}
                stroke={src.color} strokeWidth="1" opacity="0.4"
                strokeDasharray="6 4" strokeDashoffset={-tick * 1.5} />
            )
          })}

          {/* Pollution plumes */}
          {SENSOR_POINTS.filter(p => p.severity !== 'low').map(p => {
            const grad = p.severity === 'high' ? 'url(#plumeHigh)' : 'url(#plumeMod)'
            const r = p.spread === 'CONCENTRATED' ? 25 : p.spread === 'LINEAR' ? 18 : 35
            return <ellipse key={`plume-${p.id}`} cx={p.x + 15} cy={p.y} rx={p.spread === 'LINEAR' ? r * 2 : r} ry={r}
              fill={grad} opacity={0.5 + 0.2 * Math.sin(tick * 0.05 + p.id)} />
          })}

          {/* Source icons */}
          {SOURCES.map(s => (
            <g key={s.id}>
              <SourceIcon type={s.type} x={s.x} y={s.y} />
              <text x={s.x} y={s.y + 28} textAnchor="middle" fill="#666" fontSize="9" fontFamily="Inter">{s.label}</text>
            </g>
          ))}

          {/* Sensor points with pulse */}
          {SENSOR_POINTS.map(p => {
            const c = SEV_COLOR[p.severity]
            const pulseR = 8 + 4 * Math.sin(tick * 0.08 + p.id * 0.7)
            return (
              <g key={`pt-${p.id}`} onClick={() => setSelected(p.id)} style={{ cursor: 'pointer' }}>
                <circle cx={p.x} cy={p.y} r={pulseR + 4} fill={c} opacity={0.15} />
                <circle cx={p.x} cy={p.y} r={pulseR} fill={c} opacity={0.25} />
                <circle cx={p.x} cy={p.y} r={5} fill={c} stroke="#080c18" strokeWidth="1.5" filter="url(#glow)" />
                <text x={p.x} y={p.y - 12} textAnchor="middle" fill="#888" fontSize="8" fontFamily="JetBrains Mono">#{p.id}</text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Detail panel */}
      <div style={{ width: 300, minWidth: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sel ? (
          <div className="page-fade" key={sel.id}>
            <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>Point #{sel.id}</span>
                <span className={`badge badge-${sel.severity}`}>{sel.severity.toUpperCase()}</span>
              </div>
              {[
                ['GPS', `${sel.lat.toFixed(6)}, ${sel.lon.toFixed(6)}`],
                ['TDS', `${sel.tds} ppm`],
                ['Turbidity', `${sel.turbidity} NTU`],
                ['Nitrate', `${sel.nitrate} ppm`],
                ['Temperature', `${sel.temp} °C`],
                ['Water Level', `${sel.level} mm`],
                ['Cluster ID', sel.clusterId >= 0 ? sel.clusterId : 'Noise'],
                ['Spread', sel.spread],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #151a28', fontSize: 12 }}>
                  <span style={{ color: '#555' }}>{label}</span>
                  <span style={{ color: '#ccc', fontFamily: 'var(--font-mono)' }}>{val}</span>
                </div>
              ))}
              {/* RGB swatch */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#555' }}>RGB</span>
                <div style={{ width: 40, height: 20, borderRadius: 4, background: `rgb(${sel.rgb.join(',')})`, border: '1px solid #222' }} />
                <span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>{sel.rgb.join(', ')}</span>
              </div>
              {selSource && (
                <div style={{ marginTop: 16, padding: 12, background: '#0a0e1a', borderRadius: 8, border: `1px solid ${selSource.color}30` }}>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>LINKED SOURCE</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: selSource.color }}>{selSource.label}</div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{selSource.type}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: '#333', fontSize: 13 }}>
            Click a sensor point on the map to view details
          </div>
        )}
        {/* Legend */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 16, marginTop: 'auto' }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Severity</div>
          {Object.entries(SEV_COLOR).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#888', marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: v }} />{k.charAt(0).toUpperCase() + k.slice(1)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
