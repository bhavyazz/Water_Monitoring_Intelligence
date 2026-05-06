import { useState, useEffect, useMemo } from 'react'
import { RIVER_PATH, SEV_C, genEvolution } from '../../data/clusterData'

const { snapshots: EVO_SNAPS, events: EVO_EVENTS } = genEvolution()

/* ═══ TAB 3: CLUSTER EVOLUTION ═══ */
export function ClusterEvolution() {
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tick, setTick] = useState(0)

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 50); return () => clearInterval(id) }, [])
  useEffect(() => {
    if (!playing || hour >= 72) { if (hour >= 72) setPlaying(false); return }
    const d = Math.max(20, 150 / speed)
    const t = setTimeout(() => setHour(h => Math.min(72, h + 1)), d)
    return () => clearTimeout(t)
  }, [playing, hour, speed])

  const snap = EVO_SNAPS[Math.min(72, Math.round(hour))]
  const visibleEvents = EVO_EVENTS.filter(e => e.hour <= hour).slice(-10)
  const worstHour = useMemo(() => {
    let best = 0, bestArea = 0
    EVO_SNAPS.forEach((s, i) => { const a = s.clusters.reduce((t, c) => t + c.r * c.r, 0); if (a > bestArea) { bestArea = a; best = i } })
    return best
  }, [])

  const totalActive = snap.clusters.length
  const totalContamKm = (snap.clusters.reduce((t, c) => t + c.r * 2, 0) / 100).toFixed(1)
  const contamPct = Math.min(100, snap.clusters.reduce((t, c) => t + c.r, 0) / 5).toFixed(0)
  const oldest = snap.clusters.reduce((o, c) => c.age > (o?.age || 0) ? c : o, null)
  const mergeCount = EVO_EVENTS.filter(e => e.type === 'merge' && e.hour <= hour).length

  return (
    <div className="page-fade">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 14, height: 'calc(100vh - 360px)' }}>
        {/* SVG Map */}
        <div style={{ background: '#060a14', borderRadius: 12, border: '1px solid #1a2332', overflow: 'hidden' }}>
          <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
            <path d={RIVER_PATH} fill="none" stroke="#051525" strokeWidth="36" strokeLinecap="round" opacity="0.8" />
            <path d={RIVER_PATH} fill="none" stroke="#0a3d5c" strokeWidth="20" strokeLinecap="round" opacity="0.5" />
            <path d={RIVER_PATH} fill="none" stroke="#20aacc" strokeWidth="1.5" opacity="0.2" strokeDasharray="6 18" strokeDashoffset={-tick * 2} />
            {snap.clusters.map(c => {
              const col = SEV_C[c.sev] || '#44cc66'
              return (
                <g key={c.id}>
                  <circle cx={c.cx} cy={c.cy} r={c.r} fill={col} fillOpacity="0.12" stroke={col} strokeWidth="1.2" strokeDasharray="4 3" style={{ transition: 'cx 0.4s, cy 0.4s, r 0.4s' }} />
                  {/* Sonar */}
                  <circle cx={c.cx} cy={c.cy} r={(tick * 0.6) % (c.r + 10)} fill="none" stroke={col} strokeWidth="0.5" opacity={Math.max(0, 0.3 - ((tick * 0.6) % (c.r + 10)) / (c.r + 10) * 0.3)} />
                  <circle cx={c.cx} cy={c.cy} r={4} fill={col} />
                  <text x={c.cx} y={c.cy - c.r - 6} textAnchor="middle" fill={col} fontSize="10" fontWeight="700" fontFamily="JetBrains Mono">C{c.id}</text>
                </g>
              )
            })}
            <text x="1060" y="30" textAnchor="end" fill="#555" fontSize="16" fontWeight="700" fontFamily="JetBrains Mono">T+{Math.round(hour)}h</text>
          </svg>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Lifecycle Stats</div>
          {[
            { l: 'Active Clusters', v: totalActive, c: '#00d4ff' },
            { l: 'Contaminated Length', v: `${totalContamKm} km`, c: '#ff4455' },
            { l: 'River Contaminated', v: `${contamPct}%`, c: '#ffaa00' },
            { l: 'Merge Events', v: mergeCount, c: '#bb66ff' },
            { l: 'Oldest Cluster', v: oldest ? `C${oldest.id} (${oldest.age}h)` : '--', c: '#44cc66' },
          ].map(s => (
            <div key={s.l} style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 8, color: '#333', textTransform: 'uppercase' }}>{s.l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.c }}>{s.v}</div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginTop: 8 }}>Event Log</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {visibleEvents.map((e, i) => (
              <div key={i} className="page-fade" style={{ padding: '5px 0', borderBottom: '1px solid #151a28', fontSize: 10 }}>
                <span style={{ color: e.type === 'birth' ? '#00d4ff' : e.type === 'merge' ? '#bb66ff' : e.type === 'disperse' ? '#44cc66' : '#ffaa00', fontWeight: 600 }}>T+{e.hour}h</span>
                <span style={{ color: '#666', marginLeft: 6 }}>{e.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline controls */}
      <div style={{ marginTop: 12, background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: '10px 16px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="filter-btn" onClick={() => setPlaying(!playing)} style={{ minWidth: 55 }}>{playing ? 'Pause' : 'Play'}</button>
          <button className="filter-btn" onClick={() => { setHour(0); setPlaying(false) }}>Reset</button>
          {[1, 4, 16].map(s => <button key={s} className={`filter-btn${speed === s ? ' active' : ''}`} onClick={() => setSpeed(s)} style={{ minWidth: 30 }}>{s}x</button>)}
          <button className="filter-btn" onClick={() => setHour(worstHour)} style={{ color: '#ff4455' }}>Worst Moment</button>
          <input type="range" min={0} max={72} value={hour} onChange={e => setHour(+e.target.value)} style={{ flex: 1, accentColor: '#00d4ff' }} />
          <span style={{ fontFamily: 'var(--font-mono)', color: '#888', fontSize: 12, minWidth: 35 }}>{Math.round(hour)}h</span>
        </div>
      </div>
    </div>
  )
}

/* ═══ TAB 4: CLUSTER COMPARISON ═══ */
export function ClusterComparison({ clusters }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(1)
  const [filter, setFilter] = useState('')
  const [hovered, setHovered] = useState(null)

  const toggleSort = (key) => { if (sortKey === key) setSortDir(-sortDir); else { setSortKey(key); setSortDir(1) } }

  /* Compute cluster stats */
  const data = useMemo(() => clusters.map(c => {
    const rs = c.readings || []
    const avg = (arr, key) => arr.length ? arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length : 0
    return {
      id: c.cluster_id, severity: c.severity, source: c.probable_source || 'Unknown',
      tds: avg(rs, 'tds'), turb: avg(rs, 'turbidity'), nit: avg(rs, 'nitrate'), temp: avg(rs, 'temperature'),
      radius: parseFloat(c.affected_radius) || 0, readings: c.reading_count || rs.length,
      direction: c.spread_direction || 'N/A', speed: c.spread_speed || 'N/A',
      sevScore: c.severity === 'HIGH' ? 3 : c.severity === 'MODERATE' ? 2 : 1,
      confidence: c.severity === 'HIGH' ? 87 : c.severity === 'MODERATE' ? 72 : 55,
    }
  }), [clusters])

  const filtered = data.filter(d => !filter || d.severity.toLowerCase().includes(filter.toLowerCase()) || d.source.toLowerCase().includes(filter.toLowerCase()))
  const sorted = sortKey ? [...filtered].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : -1) * sortDir) : filtered

  /* Parallel coordinates axes */
  const axes = [
    { key: 'sevScore', label: 'Severity', max: 3 },
    { key: 'tds', label: 'TDS', max: 800 },
    { key: 'turb', label: 'Turbidity', max: 5 },
    { key: 'nit', label: 'Nitrate', max: 40 },
    { key: 'temp', label: 'Temp', max: 35 },
    { key: 'radius', label: 'Radius', max: 300 },
    { key: 'readings', label: 'Readings', max: 20 },
    { key: 'confidence', label: 'Confidence', max: 100 },
  ]
  const pcW = 700, pcH = 200, padL = 40, padR = 20

  return (
    <div className="page-fade">
      {/* Parallel Coordinates */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginBottom: 8 }}>Parallel Coordinates — Cluster Profiles</div>
        <svg viewBox={`0 0 ${pcW} ${pcH + 30}`} style={{ width: '100%', maxHeight: 250 }}>
          {/* Axes */}
          {axes.map((a, i) => {
            const x = padL + (i / (axes.length - 1)) * (pcW - padL - padR)
            return (
              <g key={a.key}>
                <line x1={x} y1={10} x2={x} y2={pcH} stroke="#1a2332" strokeWidth="1" />
                <text x={x} y={pcH + 14} textAnchor="middle" fill="#444" fontSize="7" fontFamily="Inter">{a.label}</text>
                <text x={x} y={6} textAnchor="middle" fill="#333" fontSize="6">{a.max}</text>
              </g>
            )
          })}
          {/* Cluster polylines */}
          {data.map(d => {
            const col = SEV_C[d.severity] || '#555'
            const isH = hovered === d.id
            const pts = axes.map((a, i) => {
              const x = padL + (i / (axes.length - 1)) * (pcW - padL - padR)
              const y = pcH - (Math.min(1, d[a.key] / a.max)) * (pcH - 15)
              return `${x},${y}`
            }).join(' ')
            return <polyline key={d.id} points={pts} fill="none" stroke={col} strokeWidth={isH ? 2.5 : 1.2} opacity={isH ? 1 : hovered !== null ? 0.1 : 0.5}
              onMouseEnter={() => setHovered(d.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer', transition: 'opacity 0.3s' }} />
          })}
          {hovered !== null && <text x={pcW - 10} y={20} textAnchor="end" fill={SEV_C[data.find(d => d.id === hovered)?.severity] || '#888'} fontSize="10" fontWeight="700">C{hovered}</text>}
        </svg>
      </div>

      {/* Sortable table */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase' }}>Cluster Data Table</div>
          <input placeholder="Filter by source or severity..." value={filter} onChange={e => setFilter(e.target.value)}
            style={{ background: '#0a0e16', border: '1px solid #1a2332', borderRadius: 4, padding: '4px 10px', color: '#888', fontSize: 11, width: 200, outline: 'none' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr>
              {[['id', 'ID'], ['severity', 'Severity'], ['tds', 'TDS'], ['turb', 'Turbidity'], ['nit', 'Nitrate'], ['temp', 'Temp'], ['radius', 'Radius'], ['readings', 'Readings'], ['source', 'Source'], ['direction', 'Dir'], ['speed', 'Speed']].map(([k, l]) => (
                <th key={k} onClick={() => toggleSort(k)} style={{ cursor: 'pointer' }}>{l} {sortKey === k ? (sortDir > 0 ? '↑' : '↓') : ''}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map(d => (
                <tr key={d.id} onMouseEnter={() => setHovered(d.id)} onMouseLeave={() => setHovered(null)} style={{ transition: 'background 0.2s' }}>
                  <td style={{ fontWeight: 700, color: SEV_C[d.severity] }}>C{d.id}</td>
                  <td><span className={`badge badge-${d.severity?.toLowerCase()}`}>{d.severity}</span></td>
                  <td>{d.tds.toFixed(0)}</td><td>{d.turb.toFixed(2)}</td><td>{d.nit.toFixed(1)}</td><td>{d.temp.toFixed(1)}</td>
                  <td>{d.radius}m</td><td>{d.readings}</td>
                  <td>{d.source.split(' ')[0]}</td><td>{d.direction}</td><td>{d.speed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mini force graph */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginBottom: 8 }}>Cluster Relationships</div>
        <svg viewBox="0 0 500 180" style={{ width: '100%', maxHeight: 200 }}>
          {/* Position clusters in a row */}
          {data.map((d, i) => {
            const x = 80 + i * (340 / Math.max(1, data.length - 1)), y = 90
            const r = 10 + d.radius / 20
            const col = SEV_C[d.severity] || '#555'
            // Edges to same-source clusters
            data.forEach((d2, j) => {
              if (j <= i) return
              const x2 = 80 + j * (340 / Math.max(1, data.length - 1))
              const sameSource = d.source === d2.source
              if (sameSource || Math.abs(i - j) === 1) {
                return // edges drawn below
              }
            })
            return (
              <g key={d.id}>
                {/* Edges */}
                {data.map((d2, j) => {
                  if (j <= i) return null
                  const x2 = 80 + j * (340 / Math.max(1, data.length - 1))
                  const sameSource = d.source === d2.source && d.source !== 'Unknown'
                  const adjacent = Math.abs(i - j) === 1
                  if (!sameSource && !adjacent) return null
                  return <line key={`e${i}-${j}`} x1={x} y1={y} x2={x2} y2={y} stroke={sameSource ? col : '#333'} strokeWidth={sameSource ? 1.5 : 0.8} strokeDasharray={sameSource ? '' : '4 3'} opacity="0.4" />
                })}
                <circle cx={x} cy={y} r={r} fill={col} fillOpacity="0.2" stroke={col} strokeWidth="1.5" />
                <text x={x} y={y + 3} textAnchor="middle" fill={col} fontSize="10" fontWeight="700" fontFamily="JetBrains Mono">C{d.id}</text>
                <text x={x} y={y + r + 12} textAnchor="middle" fill="#444" fontSize="7">{d.source.split(' ')[0]}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
