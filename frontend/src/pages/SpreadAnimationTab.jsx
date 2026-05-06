import { useState, useEffect, useMemo } from 'react'
import { SOURCES, RIVER_PATH, SENSOR_POINTS } from '../data/syntheticData'

const SEV_COLOR = { high: '#ff4455', moderate: '#ffaa00', low: '#44cc66' }

export default function SpreadAnimationTab() {
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tick, setTick] = useState(0)

  /* Animation tick for visual effects */
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60)
    return () => clearInterval(id)
  }, [])

  /* Playback: advance timeline */
  useEffect(() => {
    if (!playing) return
    if (hour >= 72) { setPlaying(false); return }
    const t = setTimeout(() => setHour(h => Math.min(72, h + 1)), 150)
    return () => clearTimeout(t)
  }, [playing, hour])

  /* Compute plume sizes based on hour */
  const plumes = useMemo(() => SENSOR_POINTS.filter(p => p.severity !== 'low').map(p => {
    const growth = Math.min(1, hour / 48)
    const baseR = p.spread === 'CONCENTRATED' ? 20 : p.spread === 'LINEAR' ? 15 : 30
    const r = baseR * (0.3 + growth * 0.7)
    const rx = p.spread === 'LINEAR' ? r * 2.5 : r
    const ry = p.spread === 'CONCENTRATED' ? r * 0.8 : r
    const downstream = p.spread === 'LINEAR' ? growth * 20 : growth * 8
    return { ...p, rx, ry, downstream, opacity: 0.2 + growth * 0.3 }
  }), [hour])

  /* Live stats */
  const aboveThreshold = SENSOR_POINTS.filter(p => p.severity !== 'low' && hour > 5).length
  const affectedKm = (hour * 0.15).toFixed(1)
  const dominant = hour > 20 ? 'Nitrate' : hour > 10 ? 'TDS' : 'Turbidity'
  const riskLevel = hour > 48 ? 'CRITICAL' : hour > 24 ? 'HIGH' : hour > 10 ? 'MODERATE' : 'LOW'
  const riskColor = { CRITICAL: '#ff4455', HIGH: '#ff6644', MODERATE: '#ffaa00', LOW: '#44cc66' }[riskLevel]

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Spread Animation</h2>
        <p>Visualize how pollution spreads from sources over time</p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <button className="filter-btn" onClick={() => { setPlaying(!playing) }} style={{ minWidth: 80 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="filter-btn" onClick={() => { setHour(0); setPlaying(false) }}>Reset</button>
        <input type="range" min={0} max={72} value={hour} onChange={e => setHour(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#2090b0' }} />
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: '#ccc', minWidth: 45 }}>{hour}h</span>
      </div>

      {/* SVG Map */}
      <div style={{ background: '#080c18', borderRadius: 12, border: '1px solid #1a1a2e', overflow: 'hidden', height: 'calc(100vh - 340px)' }}>
        <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
          <defs>
            <radialGradient id="spH"><stop offset="0%" stopColor="#ff4455" stopOpacity="0.5" /><stop offset="100%" stopColor="#ff4455" stopOpacity="0" /></radialGradient>
            <radialGradient id="spM"><stop offset="0%" stopColor="#ffaa00" stopOpacity="0.4" /><stop offset="100%" stopColor="#ffaa00" stopOpacity="0" /></radialGradient>
            <filter id="beacon"><feGaussianBlur stdDeviation="4" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>

          {/* River */}
          <path d={RIVER_PATH} fill="none" stroke="#0a3d5c" strokeWidth="28" strokeLinecap="round" opacity="0.5" />
          <path d={RIVER_PATH} fill="none" stroke="#1a6a8a" strokeWidth="14" strokeLinecap="round" opacity="0.6" />
          <path d={RIVER_PATH} fill="none" stroke="#30b0d0" strokeWidth="1.5" opacity="0.3"
            strokeDasharray="8 20" strokeDashoffset={-tick * 2} />

          {/* Plumes that grow with time */}
          {plumes.map(p => (
            <ellipse key={`pl-${p.id}`} cx={p.x + p.downstream} cy={p.y}
              rx={p.rx} ry={p.ry}
              fill={p.severity === 'high' ? 'url(#spH)' : 'url(#spM)'}
              opacity={p.opacity * (0.7 + 0.3 * Math.sin(tick * 0.04 + p.id))} />
          ))}

          {/* Merge zones (when plumes overlap after enough time) */}
          {hour > 30 && (
            <ellipse cx={350} cy={260} rx={100} ry={30} fill="#ff4455" opacity={0.06 * Math.min(1, (hour - 30) / 20)} />
          )}

          {/* Source markers */}
          {SOURCES.map(s => (
            <g key={s.id}>
              <rect x={s.x - 14} y={s.y - 14} width={28} height={28} rx={6}
                fill="#0a0e1a" stroke={s.color} strokeWidth="1.2" opacity={0.7} />
              <text x={s.x} y={s.y + 4} textAnchor="middle" fill={s.color} fontSize="10" fontWeight="600"
                fontFamily="var(--font-mono)">{s.type[0]}</text>
              <text x={s.x} y={s.y + 24} textAnchor="middle" fill="#444" fontSize="8" fontFamily="Inter">{s.label}</text>
            </g>
          ))}

          {/* Sensor points with cluster beacons */}
          {SENSOR_POINTS.map(p => {
            const c = SEV_COLOR[p.severity]
            const isCluster = p.clusterId >= 0
            const beaconR = 6 + 3 * Math.sin(tick * 0.06 + p.id)
            return (
              <g key={`sp-${p.id}`}>
                {isCluster && hour > 5 && (
                  <circle cx={p.x} cy={p.y} r={beaconR + 6} fill={c} opacity={0.12} filter="url(#beacon)" />
                )}
                <circle cx={p.x} cy={p.y} r={4} fill={c} stroke="#080c18" strokeWidth="1.5" />
              </g>
            )
          })}
        </svg>
      </div>

      {/* Live stats panel */}
      <div className="spread-info-panel">
        <div className="spread-info-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <div className="label">Affected Length</div>
          <div className="value">{affectedKm} km</div>
        </div>
        <div className="spread-info-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <div className="label">Points Above Safe</div>
          <div className="value">{aboveThreshold}</div>
        </div>
        <div className="spread-info-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <div className="label">Dominant Pollutant</div>
          <div className="value">{dominant}</div>
        </div>
        <div className="spread-info-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <div className="label">Risk Level</div>
          <div className="value" style={{ color: riskColor }}>{riskLevel}</div>
        </div>
      </div>

      {/* Spread type legend */}
      <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 11, color: '#555' }}>
        <span>LINEAR — elongated downstream plume</span>
        <span>CONCENTRATED — tight radial hotspot</span>
        <span>DIFFUSE — wide scattered haze</span>
      </div>
    </div>
  )
}
