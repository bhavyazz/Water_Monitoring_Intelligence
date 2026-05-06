import { useState, useEffect, useRef, useMemo } from 'react'
import { SOURCES, SENSOR_POINTS } from '../data/syntheticData'

const SRC_COLORS = { Factory: '#ff4455', Farm: '#44cc66', Sewage: '#ffaa00', Landfill: '#bb66ff' }
const SEV = { high: '#ff4455', moderate: '#ffaa00', low: '#44cc66' }

/* Generate edges: source → sensor, with contribution strength */
function buildEdges() {
  const edges = []
  SENSOR_POINTS.forEach(p => {
    SOURCES.forEach(s => {
      const dx = p.x - s.x, dy = p.y - s.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const maxDist = 350
      if (dist < maxDist) {
        const str = Math.max(5, Math.round((1 - dist / maxDist) * 100 * (p.sourceId === s.id ? 2 : 0.5)))
        edges.push({ from: `src-${s.id}`, to: `pt-${p.id}`, strength: Math.min(100, str), sourceType: s.type, color: s.color })
      }
    })
  })
  return edges
}

/* Simple force simulation (SVG-based, no D3 dependency) */
function useForceLayout(nodes, edges, width, height) {
  const posRef = useRef(null)

  if (!posRef.current) {
    posRef.current = {}
    nodes.forEach(n => {
      if (n.fixed) { posRef.current[n.id] = { x: n.fx, y: n.fy, vx: 0, vy: 0 } }
      else { posRef.current[n.id] = { x: width * 0.2 + Math.random() * width * 0.6, y: height * 0.4 + Math.random() * height * 0.4, vx: 0, vy: 0 } }
    })
  }

  const [positions, setPositions] = useState(() => ({ ...posRef.current }))

  useEffect(() => {
    let raf
    const tick = () => {
      const pos = posRef.current
      // Repulsion between all nodes
      const ids = Object.keys(pos)
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]]
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.max(10, Math.sqrt(dx * dx + dy * dy))
          const force = 800 / (dist * dist)
          const fx = (dx / dist) * force, fy = (dy / dist) * force
          if (!nodes.find(n => n.id === ids[i])?.fixed) { a.vx -= fx; a.vy -= fy }
          if (!nodes.find(n => n.id === ids[j])?.fixed) { b.vx += fx; b.vy += fy }
        }
      }
      // Edge attraction
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to]
        if (!a || !b) return
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const force = (dist - 120) * 0.003
        const fx = (dx / Math.max(1, dist)) * force, fy = (dy / Math.max(1, dist)) * force
        if (!nodes.find(n => n.id === e.to)?.fixed) { b.vx -= fx; b.vy -= fy }
      })
      // Gravity toward center
      ids.forEach(id => {
        const n = nodes.find(nd => nd.id === id)
        if (n?.fixed) return
        const p = pos[id]
        p.vx += (width / 2 - p.x) * 0.0005
        p.vy += (height * 0.55 - p.y) * 0.0005
      })
      // Apply velocity with damping
      ids.forEach(id => {
        const n = nodes.find(nd => nd.id === id)
        if (n?.fixed) return
        const p = pos[id]
        p.vx *= 0.85; p.vy *= 0.85
        p.x = Math.max(30, Math.min(width - 30, p.x + p.vx))
        p.y = Math.max(30, Math.min(height - 30, p.y + p.vy))
      })
      setPositions({ ...pos })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [nodes, edges, width, height])

  return positions
}

export default function ContaminationWeb() {
  const [threshold, setThreshold] = useState(10)
  const [hoveredSrc, setHoveredSrc] = useState(null)
  const [hoveredPt, setHoveredPt] = useState(null)
  const [selectedSrc, setSelectedSrc] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 80); return () => clearInterval(id) }, [])

  const W = 800, H = 500

  const allEdges = useMemo(() => buildEdges(), [])
  const filteredEdges = useMemo(() => allEdges.filter(e => e.strength >= threshold), [allEdges, threshold])

  const nodes = useMemo(() => [
    ...SOURCES.map((s, i) => ({ id: `src-${s.id}`, type: 'source', data: s, fixed: true, fx: 120 + i * (W - 240) / 3, fy: 60 })),
    ...SENSOR_POINTS.map(p => ({ id: `pt-${p.id}`, type: 'sensor', data: p, fixed: false })),
  ], [])

  const positions = useForceLayout(nodes, filteredEdges, W, H)

  /* Network stress */
  const stress = useMemo(() => {
    const totalWeight = filteredEdges.reduce((s, e) => s + e.strength, 0)
    const critNodes = SENSOR_POINTS.filter(p => p.severity === 'high').length
    return Math.min(100, Math.round(totalWeight / 50 + critNodes * 15))
  }, [filteredEdges])

  const stressColor = stress > 70 ? '#ff4455' : stress > 40 ? '#ffaa00' : '#44cc66'

  const activeHighlight = hoveredSrc || selectedSrc

  /* Source → connected sensor IDs for highlight */
  const highlightedPts = useMemo(() => {
    if (!activeHighlight) return new Set()
    const srcId = `src-${activeHighlight}`
    return new Set(filteredEdges.filter(e => e.from === srcId).map(e => e.to))
  }, [activeHighlight, filteredEdges])

  /* Point → contributing sources for hover tooltip */
  const ptContributions = useMemo(() => {
    if (!hoveredPt) return []
    return filteredEdges.filter(e => e.to === `pt-${hoveredPt}`).map(e => {
      const src = SOURCES.find(s => `src-${s.id}` === e.from)
      return { name: src?.type, strength: e.strength, color: e.color }
    }).sort((a, b) => b.strength - a.strength)
  }, [hoveredPt, filteredEdges])

  const selSrc = selectedSrc ? SOURCES.find(s => s.id === selectedSrc) : null

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Contamination Web</h2>
        <p>Force-directed network showing causal relationships between sources and sensors</p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 10, color: '#444' }}>Contribution Threshold:</span>
        <input type="range" min={0} max={100} value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ width: 200, accentColor: '#00d4ff' }} />
        <span style={{ fontFamily: 'var(--font-mono)', color: '#888', fontSize: 12, minWidth: 30 }}>{threshold}%</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#444' }}>Network Stress:</span>
          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: stressColor }}>{stress}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedSrc ? '1fr 280px' : '1fr', gap: 14 }}>
        {/* Network SVG */}
        <div style={{ background: stress > 70 ? `#0d1117` : '#0d1117', borderRadius: 12, border: `1px solid ${stress > 70 ? '#ff445520' : '#1a2332'}`, overflow: 'hidden', height: 'calc(100vh - 280px)', position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
            {/* Edges */}
            {filteredEdges.map((e, i) => {
              const a = positions[e.from], b = positions[e.to]
              if (!a || !b) return null
              const dimmed = activeHighlight && !highlightedPts.has(e.to) && e.from !== `src-${activeHighlight}`
              const hovered = hoveredPt && e.to === `pt-${hoveredPt}`
              return (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={e.color} strokeWidth={Math.max(0.5, e.strength / 30)}
                  opacity={dimmed ? 0.05 : hovered ? 0.8 : 0.25}
                  style={{ transition: 'opacity 0.3s' }} />
              )
            })}

            {/* Sensor nodes */}
            {SENSOR_POINTS.map(p => {
              const pos = positions[`pt-${p.id}`]
              if (!pos) return null
              const dimmed = activeHighlight && !highlightedPts.has(`pt-${p.id}`)
              const isHigh = p.severity === 'high'
              const pulseR = isHigh ? 8 + 3 * Math.sin(tick * 0.08 + p.id) : 0
              return (
                <g key={`pt-${p.id}`} onMouseEnter={() => setHoveredPt(p.id)} onMouseLeave={() => setHoveredPt(null)} style={{ cursor: 'pointer' }}>
                  {isHigh && <circle cx={pos.x} cy={pos.y} r={pulseR + 4} fill="#ff4455" opacity={dimmed ? 0.02 : 0.1} />}
                  <circle cx={pos.x} cy={pos.y} r={6} fill={SEV[p.severity]} stroke="#0d1117" strokeWidth="1.5"
                    opacity={dimmed ? 0.15 : 1} style={{ transition: 'opacity 0.3s' }} />
                  {/* Hover tooltip — pie chart */}
                  {hoveredPt === p.id && ptContributions.length > 0 && (
                    <g>
                      <rect x={pos.x + 12} y={pos.y - 50} width={120} height={ptContributions.length * 16 + 24} rx={6} fill="#0a0e16" stroke="#1a2332" strokeWidth="1" opacity="0.95" />
                      <text x={pos.x + 20} y={pos.y - 34} fill="#ccc" fontSize="9" fontWeight="600">Point #{p.id}</text>
                      {ptContributions.map((c, ci) => (
                        <g key={ci}>
                          <rect x={pos.x + 18} y={pos.y - 22 + ci * 16} width={c.strength * 0.7} height={8} rx={2} fill={c.color} opacity="0.6" />
                          <text x={pos.x + 90} y={pos.y - 15 + ci * 16} fill="#888" fontSize="8" fontFamily="var(--font-mono)">{c.name} {c.strength}%</text>
                        </g>
                      ))}
                    </g>
                  )}
                </g>
              )
            })}

            {/* Source nodes (hexagons) */}
            {SOURCES.map(s => {
              const pos = positions[`src-${s.id}`]
              if (!pos) return null
              const dimmed = activeHighlight && activeHighlight !== s.id
              const hex = Array.from({ length: 6 }).map((_, i) => {
                const a = (i * 60 - 30) * Math.PI / 180
                return `${pos.x + 18 * Math.cos(a)},${pos.y + 18 * Math.sin(a)}`
              }).join(' ')
              return (
                <g key={`src-${s.id}`}
                  onMouseEnter={() => { if (!selectedSrc) setHoveredSrc(s.id) }}
                  onMouseLeave={() => { if (!selectedSrc) setHoveredSrc(null) }}
                  onClick={() => setSelectedSrc(selectedSrc === s.id ? null : s.id)}
                  style={{ cursor: 'pointer' }}>
                  <polygon points={hex} fill="#0a0e1a" stroke={s.color} strokeWidth="2" opacity={dimmed ? 0.2 : 1} style={{ transition: 'opacity 0.3s' }} />
                  <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill={s.color} fontSize="12" fontWeight="700" fontFamily="var(--font-mono)" opacity={dimmed ? 0.2 : 1}>{s.type[0]}</text>
                  <text x={pos.x} y={pos.y + 30} textAnchor="middle" fill="#444" fontSize="8" opacity={dimmed ? 0.1 : 1}>{s.type}</text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Selected source detail panel */}
        {selSrc && (
          <div className="page-fade" style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 18, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: selSrc.color }}>{selSrc.label}</span>
              <button onClick={() => setSelectedSrc(null)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 6 }}>TYPE</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>{selSrc.type}</div>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 6 }}>WASTE MATERIALS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
              {selSrc.waste.map(w => <span key={w} style={{ fontSize: 10, padding: '3px 7px', borderRadius: 3, background: selSrc.color + '15', color: selSrc.color, fontFamily: 'var(--font-mono)' }}>{w}</span>)}
            </div>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 6 }}>CONNECTED SENSORS</div>
            {SENSOR_POINTS.filter(p => filteredEdges.some(e => e.from === `src-${selSrc.id}` && e.to === `pt-${p.id}`)).map(p => (
              <div key={p.id} style={{ fontSize: 11, padding: '5px 0', borderBottom: '1px solid #151a28', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Point #{p.id}</span>
                <span className={`badge badge-${p.severity}`}>{p.severity}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
