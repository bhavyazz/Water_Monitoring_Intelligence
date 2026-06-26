import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchCausality, fetchCausalityHistory } from '../api'

const PARAM_COLORS = {
  DO: '#2090b0',
  pH: '#6c5ce7',
  conductivity: '#d4a017',
  turbidity: '#888',
  BOD: '#c0392b',
  nitrate: '#27ae60',
}

const SEVERITY_COLOR = {
  HIGH: '#ff4455',
  MODERATE: '#ffaa00',
  LOW: '#44cc66',
}

const TYPE_LABELS = {
  industrial_discharge: 'Industrial Discharge',
  agricultural_runoff: 'Agricultural Runoff',
  sewage_contamination: 'Sewage Contamination',
  normal: 'Normal',
  unknown: 'Unknown',
}

const ALL_PARAMS = ['DO', 'pH', 'conductivity', 'turbidity', 'BOD', 'nitrate']

/* ── Force-directed graph layout (pure React state, no external lib) ── */

function useForceLayout(nodes, edges) {
  const [positions, setPositions] = useState({})
  const frameRef = useRef(null)
  const velRef = useRef({})

  useEffect(() => {
    if (!nodes.length) return
    const cx = 200, cy = 180, r = 130
    const initial = {}
    const vel = {}
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
      initial[n] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
      vel[n] = { vx: 0, vy: 0 }
    })
    setPositions(initial)
    velRef.current = vel
  }, [nodes.join(',')])

  useEffect(() => {
    if (!nodes.length || !Object.keys(positions).length) return
    let running = true
    const tick = () => {
      if (!running) return
      setPositions(prev => {
        const next = { ...prev }
        const v = velRef.current
        const damping = 0.85
        const repulsion = 3000
        const attraction = 0.005
        const cx = 200, cy = 180

        for (const n of nodes) {
          if (!next[n]) continue
          let fx = 0, fy = 0

          // Repulsion between all nodes
          for (const m of nodes) {
            if (n === m || !next[m]) continue
            const dx = next[n].x - next[m].x
            const dy = next[n].y - next[m].y
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
            fx += (dx / dist) * repulsion / (dist * dist)
            fy += (dy / dist) * repulsion / (dist * dist)
          }

          // Attraction to center
          fx += (cx - next[n].x) * attraction
          fy += (cy - next[n].y) * attraction

          // Edge attraction
          for (const e of edges) {
            const other = e.from === n ? e.to : e.to === n ? e.from : null
            if (!other || !next[other]) continue
            const dx = next[other].x - next[n].x
            const dy = next[other].y - next[n].y
            fx += dx * 0.01
            fy += dy * 0.01
          }

          if (!v[n]) v[n] = { vx: 0, vy: 0 }
          v[n].vx = (v[n].vx + fx * 0.1) * damping
          v[n].vy = (v[n].vy + fy * 0.1) * damping
          next[n] = {
            x: Math.max(40, Math.min(360, next[n].x + v[n].vx)),
            y: Math.max(40, Math.min(320, next[n].y + v[n].vy)),
          }
        }
        return next
      })
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    // Stop after 3 seconds to save CPU
    const timeout = setTimeout(() => { running = false }, 3000)
    return () => { running = false; cancelAnimationFrame(frameRef.current); clearTimeout(timeout) }
  }, [nodes.join(','), edges.length, Object.keys(positions).length])

  return [positions, setPositions]
}

function CausalGraph({ graph }) {
  const nodeSet = new Set()
  graph.forEach(e => { nodeSet.add(e.from); nodeSet.add(e.to) })
  const nodes = ALL_PARAMS.filter(p => nodeSet.has(p))
  if (!nodes.length) nodes.push(...ALL_PARAMS)
  const [layoutPos, setLayoutPos] = useForceLayout(nodes, graph)
  const [dragOverrides, setDragOverrides] = useState({})
  const positions = { ...layoutPos, ...dragOverrides }

  const [dragging, setDragging] = useState(null)
  const svgRef = useRef(null)

  const onMouseDown = useCallback((node, e) => {
    e.preventDefault()
    setDragging(node)
  }, [])

  const onMouseMove = useCallback((e) => {
    if (!dragging || !svgRef.current) return
    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()
    const x = Math.max(40, Math.min(360, ((e.clientX - rect.left) / rect.width) * 400))
    const y = Math.max(40, Math.min(320, ((e.clientY - rect.top) / rect.height) * 360))
    setDragOverrides(prev => ({ ...prev, [dragging]: { x, y } }))
  }, [dragging])

  const onMouseUp = useCallback(() => setDragging(null), [])

  if (!Object.keys(positions).length) {
    return <div className="empty-state">Initializing graph layout...</div>
  }

  const arrowId = 'causal-arrow'

  return (
    <svg ref={svgRef} viewBox="0 0 400 360" style={{ width: '100%', height: '100%', cursor: dragging ? 'grabbing' : 'default' }}
      onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
        </marker>
        {graph.map((e, i) => e.strength > 0.8 ? (
          <marker key={`arrow-strong-${i}`} id={`arrow-s-${i}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff4455" />
          </marker>
        ) : null)}
      </defs>

      {/* Edges */}
      {graph.map((e, i) => {
        const from = positions[e.from]
        const to = positions[e.to]
        if (!from || !to) return null
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) return null
        const nx = dx / dist, ny = dy / dist
        const x1 = from.x + nx * 22, y1 = from.y + ny * 22
        const x2 = to.x - nx * 22, y2 = to.y - ny * 22
        const strong = e.strength > 0.8
        const midX = (x1 + x2) / 2 + ny * 12
        const midY = (y1 + y2) / 2 - nx * 12

        return (
          <g key={`edge-${i}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={strong ? '#ff4455' : 'var(--text-muted)'}
              strokeWidth={strong ? 2 : 1}
              strokeOpacity={strong ? 0.8 : 0.4}
              markerEnd={strong ? `url(#arrow-s-${i})` : `url(#${arrowId})`}>
              {strong && <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />}
            </line>
            <text x={midX} y={midY} textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="JetBrains Mono">
              {e.lag}h
            </text>
          </g>
        )
      })}

      {/* Nodes */}
      {nodes.map(n => {
        const pos = positions[n]
        if (!pos) return null
        const col = PARAM_COLORS[n] || 'var(--text-muted)'
        const hasEdges = graph.some(e => e.from === n || e.to === n)
        return (
          <g key={n} style={{ cursor: 'grab' }}
            onMouseDown={(e) => onMouseDown(n, e)}>
            <circle cx={pos.x} cy={pos.y} r={hasEdges ? 20 : 16}
              fill="var(--bg-card)" stroke={col} strokeWidth={hasEdges ? 2 : 1.5}
              opacity={hasEdges ? 1 : 0.5} />
            <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle"
              fill={col} fontSize={n.length > 4 ? 7 : 9} fontWeight="600" fontFamily="JetBrains Mono">
              {n}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* ── Heatmap grid ── */

function HeatmapGrid({ lagMatrix }) {
  const maxStr = 1.0
  const cellColor = (str) => {
    if (str <= 0) return 'transparent'
    const alpha = Math.min(0.7, str / maxStr * 0.7)
    if (str > 0.8) return `rgba(192, 57, 43, ${alpha})`
    if (str > 0.5) return `rgba(212, 160, 23, ${alpha})`
    return `rgba(39, 174, 96, ${alpha})`
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr>
            <th style={{ padding: '6px 8px', fontSize: 9, color: 'var(--text-muted)', textAlign: 'left' }}>Cause \ Effect</th>
            {ALL_PARAMS.map(p => (
              <th key={p} style={{ padding: '6px 8px', color: PARAM_COLORS[p], fontSize: 9, textAlign: 'center' }}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_PARAMS.map(cause => (
            <tr key={cause}>
              <td style={{ padding: '6px 8px', color: PARAM_COLORS[cause], fontWeight: 600, fontSize: 9 }}>{cause}</td>
              {ALL_PARAMS.map(effect => {
                if (cause === effect) {
                  return <td key={effect} style={{ padding: 4, textAlign: 'center', color: 'var(--text-muted)', fontSize: 8 }}>--</td>
                }
                const info = lagMatrix?.[cause]?.[effect]
                if (!info) {
                  return <td key={effect} style={{ padding: 4, textAlign: 'center', background: 'transparent' }} />
                }
                return (
                  <td key={effect} style={{
                    padding: '4px 6px', textAlign: 'center',
                    background: cellColor(info.strength),
                    borderRadius: 3, color: info.strength > 0.6 ? '#fff' : 'var(--text-secondary)',
                    fontWeight: info.strength > 0.7 ? 600 : 400,
                  }}>
                    {info.lag}h
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Warning timeline mini-bar ── */

function MiniTimeline({ warnings }) {
  if (!warnings.length) return null
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const start = now - dayMs

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Last 24 Hours</div>
      <svg viewBox="0 0 400 20" style={{ width: '100%', height: 20 }}>
        <rect x="0" y="8" width="400" height="4" rx="2" fill="var(--border)" />
        {warnings.map((w, i) => {
          const ts = new Date(w.timestamp).getTime()
          if (ts < start) return null
          const x = ((ts - start) / dayMs) * 400
          const col = SEVERITY_COLOR[w.severity] || '#ffaa00'
          return (
            <g key={i}>
              <circle cx={x} cy={10} r={4} fill={col} opacity={0.9} />
              <circle cx={x} cy={10} r={6} fill={col} opacity={0.2} />
            </g>
          )
        })}
        {/* Time labels */}
        <text x="0" y="19" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">-24h</text>
        <text x="200" y="19" textAnchor="middle" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">-12h</text>
        <text x="400" y="19" textAnchor="end" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">now</text>
      </svg>
    </div>
  )
}

/* ── Main component ── */

export default function CausalityIntelligence() {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [tab, setTab] = useState(0)

  useEffect(() => {
    const load = () => {
      fetchCausality().then(setData).catch(() => {})
      fetchCausalityHistory().then(d => setHistory(d?.warnings || [])).catch(() => {})
    }
    load()
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
  }, [])

  const graph = data?.graph || []
  const lagMatrix = data?.lag_matrix || {}
  const prediction = data?.prediction || {}
  const warning = data?.active_warning || null
  const insufficient = data?.insufficient_data

  const tabs = ['Causal Graph', 'Pollution Fingerprint', 'Warning Timeline']

  return (
    <div className="page-fade">
      {/* Active warning banner */}
      {warning && (
        <div style={{
          background: 'linear-gradient(90deg, #ff445520, #ff445508)',
          border: '1px solid #ff445530', borderRadius: 8,
          padding: '10px 20px', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          animation: 'highPulse 1.5s infinite',
        }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#ff4455' }}>
              {warning.severity}: {TYPE_LABELS[warning.pollution_type]} detected
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12 }}>
              Impact in ~{warning.predicted_impact_in_hours}h | {(warning.confidence * 100).toFixed(0)}% confidence
            </span>
          </div>
          <span style={{ fontSize: 11, color: '#ff6666', fontFamily: 'var(--font-mono)' }}>
            Trigger: {warning.trigger_parameter}
          </span>
        </div>
      )}

      <div className="page-header">
        <h2>Causal Intelligence</h2>
        <p>Granger causality-based pollution fingerprinting and early warning system</p>
      </div>

      {/* Method box */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '12px 16px', marginBottom: 16, fontSize: 11,
        display: 'flex', gap: 24, alignItems: 'center',
      }}>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Method</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>Granger Causality</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Max Lag</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>12 hours</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Classifier</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>Random Forest</div>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Significance</span>
          <div style={{ fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 2 }}>p {'<'} 0.05</div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16, marginLeft: 8, flex: 1, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Tests whether past values of one parameter predict future values of another. Identifies causal chains and classifies pollution type from lag fingerprints.
        </div>
      </div>

      {/* Tabs */}
      <div className="filter-bar">
        {tabs.map((t, i) => (
          <button key={t} className={`filter-btn${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
        {prediction?.type && prediction.type !== 'unknown' && (
          <span className={`badge badge-${prediction.type === 'normal' ? 'safe' : prediction.confidence > 0.8 ? 'critical' : 'warning'}`} style={{ marginLeft: 'auto' }}>
            {TYPE_LABELS[prediction.type]} ({(prediction.confidence * 100).toFixed(0)}%)
          </span>
        )}
      </div>

      {insufficient ? (
        <div className="empty-state">
          <div style={{ fontSize: 14, marginBottom: 8 }}>Insufficient data for causality analysis</div>
          <div style={{ fontSize: 12 }}>Need at least 50 readings. Current: {data?.reading_count || 0}</div>
        </div>
      ) : (
        <>
          {/* Tab 0: Causal Graph */}
          {tab === 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
              <div className="chart-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <h3>Parameter Causality Network</h3>
                <div style={{ height: 360 }}>
                  {graph.length > 0 ? (
                    <CausalGraph graph={graph} />
                  ) : (
                    <div className="empty-state">No significant causal relationships detected at p {'<'} 0.05</div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Causal Edges ({graph.length})
                </div>
                {graph.map((e, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-card)', border: `1px solid ${e.strength > 0.8 ? '#ff445530' : 'var(--border)'}`,
                    borderRadius: 8, padding: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        <span style={{ color: PARAM_COLORS[e.from] }}>{e.from}</span>
                        <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>&rarr;</span>
                        <span style={{ color: PARAM_COLORS[e.to] }}>{e.to}</span>
                      </span>
                      <span className={`badge badge-${e.strength > 0.8 ? 'high' : e.strength > 0.5 ? 'moderate' : 'low'}`}>
                        {(e.strength * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-muted)' }}>
                      <span>Lag: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{e.lag}h</span></span>
                      <span>p-value: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{e.p_value?.toFixed(4)}</span></span>
                    </div>
                    <div style={{ height: 2, background: 'var(--border)', borderRadius: 1, marginTop: 6 }}>
                      <div style={{
                        height: '100%', borderRadius: 1, width: `${e.strength * 100}%`,
                        background: e.strength > 0.8 ? '#ff4455' : e.strength > 0.5 ? '#ffaa00' : '#44cc66',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                ))}
                {graph.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                    Waiting for analysis results...
                  </div>
                )}

                {/* Legend */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Parameters</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ALL_PARAMS.map(p => (
                      <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: PARAM_COLORS[p], display: 'inline-block' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{p}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 1: Pollution Fingerprint */}
          {tab === 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Heatmap */}
                <div className="chart-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <h3>Lag Strength Heatmap (Cause → Effect)</h3>
                  <HeatmapGrid lagMatrix={lagMatrix} />
                  <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 9, color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 12, height: 8, borderRadius: 2, background: 'rgba(39, 174, 96, 0.4)' }} /> Weak
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 12, height: 8, borderRadius: 2, background: 'rgba(212, 160, 23, 0.5)' }} /> Moderate
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 12, height: 8, borderRadius: 2, background: 'rgba(192, 57, 43, 0.6)' }} /> Strong
                    </span>
                  </div>
                </div>

                {/* Prediction card */}
                {prediction?.type && (
                  <div style={{
                    background: 'var(--bg-card)',
                    border: `1px solid ${prediction.type !== 'normal' && prediction.type !== 'unknown' ? '#ff445530' : 'var(--border)'}`,
                    borderRadius: 12, padding: 20,
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Pollution Type Prediction</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                      <span style={{
                        fontSize: 16, fontWeight: 700,
                        color: prediction.type === 'normal' ? '#44cc66' : prediction.confidence > 0.8 ? '#ff4455' : '#ffaa00',
                      }}>
                        {TYPE_LABELS[prediction.type]}
                      </span>
                      <span className={`badge badge-${prediction.type === 'normal' ? 'safe' : 'warning'}`}>
                        {(prediction.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>

                    {/* Confidence bar */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>
                        <span>Confidence</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{(prediction.confidence * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${prediction.confidence * 100}%`,
                          background: prediction.confidence > 0.8 ? '#ff4455' : prediction.confidence > 0.5 ? '#ffaa00' : '#44cc66',
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>

                    {prediction.warning_horizon_hours > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Warning horizon: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#ff4455' }}>
                          {prediction.warning_horizon_hours}h
                        </span> before downstream impact
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Fingerprint signatures */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Known Fingerprints
                </div>
                {[
                  {
                    type: 'Industrial Discharge', color: '#c0392b',
                    chain: 'conductivity → pH (2h) → DO (3h)',
                    desc: 'Chemical discharge causes conductivity spike, pH drop follows, then dissolved oxygen crashes',
                  },
                  {
                    type: 'Agricultural Runoff', color: '#27ae60',
                    chain: 'nitrate → turbidity (4h) → DO (6h)',
                    desc: 'Fertilizer runoff spikes nitrate first, then soil particles increase turbidity',
                  },
                  {
                    type: 'Sewage Contamination', color: '#d4a017',
                    chain: 'BOD → DO (2h) → conductivity (1h)',
                    desc: 'Organic waste raises BOD, bacteria consume oxygen, mild conductivity increase',
                  },
                ].map(fp => (
                  <div key={fp.type} style={{
                    background: 'var(--bg-card)', border: `1px solid ${fp.color}20`,
                    borderRadius: 10, padding: 14,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: fp.color, marginBottom: 4 }}>{fp.type}</div>
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginBottom: 6,
                      padding: '4px 8px', background: `${fp.color}08`, borderRadius: 4, display: 'inline-block',
                    }}>
                      {fp.chain}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>{fp.desc}</div>
                  </div>
                ))}

                {/* Active warning detail */}
                {warning && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 }}>
                      Active Warning
                    </div>
                    <div style={{
                      background: 'var(--bg-card)', border: '1px solid #ff445530',
                      borderRadius: 10, padding: 14,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, color: '#ff4455', fontSize: 12 }}>
                          {TYPE_LABELS[warning.pollution_type]}
                        </span>
                        <span className="badge badge-critical">{warning.severity}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
                        Causal chain:
                      </div>
                      {warning.causal_chain?.map((c, i) => (
                        <div key={i} style={{
                          fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                          padding: '2px 0 2px 8px', borderLeft: '2px solid #ff445530', marginBottom: 2,
                        }}>
                          {c}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Warning Timeline */}
          {tab === 2 && (
            <div>
              <MiniTimeline warnings={history} />

              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                {[
                  { label: 'Total Warnings', value: history.length, color: 'var(--text-secondary)' },
                  { label: 'Industrial', value: history.filter(w => w.pollution_type === 'industrial_discharge').length, color: '#c0392b' },
                  { label: 'Agricultural', value: history.filter(w => w.pollution_type === 'agricultural_runoff').length, color: '#27ae60' },
                  { label: 'Sewage', value: history.filter(w => w.pollution_type === 'sewage_contamination').length, color: '#d4a017' },
                ].map(s => (
                  <div key={s.label} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                    padding: '10px 16px', flex: 1, textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
                {history.length === 0 && (
                  <div className="empty-state">No warnings recorded yet. The system monitors live readings and alerts when causal pollution patterns are detected.</div>
                )}
                {[...history].reverse().map((w, i) => {
                  const typeColor = w.pollution_type === 'industrial_discharge' ? '#c0392b'
                    : w.pollution_type === 'agricultural_runoff' ? '#27ae60' : '#d4a017'
                  return (
                    <div key={i} className="alert-item" style={{ borderLeftColor: typeColor }}>
                      <div className="alert-info">
                        <div className="alert-type" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`badge badge-${w.severity?.toLowerCase()}`}>{w.severity}</span>
                          <span style={{ color: typeColor, fontWeight: 600 }}>{TYPE_LABELS[w.pollution_type]}</span>
                        </div>
                        <div className="alert-message" style={{ marginTop: 4 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {(w.confidence * 100).toFixed(0)}% confidence
                          </span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>|</span>
                          <span>Impact in ~{w.predicted_impact_in_hours}h</span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>|</span>
                          <span>Trigger: {w.trigger_parameter}</span>
                        </div>
                        {w.causal_chain?.length > 0 && (
                          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {w.causal_chain.map((c, j) => (
                              <span key={j} style={{
                                fontSize: 9, fontFamily: 'var(--font-mono)',
                                color: 'var(--text-secondary)',
                                padding: '2px 6px', background: `${typeColor}08`,
                                borderRadius: 3, border: `1px solid ${typeColor}15`,
                              }}>
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="alert-time">
                        {w.timestamp ? new Date(w.timestamp).toLocaleString() : '--'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
