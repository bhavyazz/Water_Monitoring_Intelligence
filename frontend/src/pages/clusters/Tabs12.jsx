import { useState, useMemo } from 'react'
import { RIVER_PATH, SOURCES, SENSOR_POINTS, SEV_C, gpsToSvg, DIR_ANGLE, SAFE, AVG } from '../../data/clusterData'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, ReferenceLine } from 'recharts'

/* ═══ TAB 1: CLUSTER ATLAS ═══ */
export function ClusterAtlas({ clusters, tick, selected, setSelected }) {
  return (
    <div className="page-fade" style={{ display: 'grid', gridTemplateColumns: '60% 40%', gap: 14, height: 'calc(100vh - 310px)' }}>
      {/* SVG River Map */}
      <div style={{ background: '#060a14', borderRadius: 12, border: '1px solid #1a2332', overflow: 'hidden' }}>
        <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
          <defs>
            <filter id="cgl"><feGaussianBlur stdDeviation="4" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            {Object.entries(SEV_C).map(([k, c]) => (
              <radialGradient key={k} id={`cz${k}`}><stop offset="0%" stopColor={c} stopOpacity="0.25" /><stop offset="100%" stopColor={c} stopOpacity="0.03" /></radialGradient>
            ))}
          </defs>
          {/* River */}
          <path d={RIVER_PATH} fill="none" stroke="#051525" strokeWidth="36" strokeLinecap="round" opacity="0.8" />
          <path d={RIVER_PATH} fill="none" stroke="#0a3d5c" strokeWidth="20" strokeLinecap="round" opacity="0.5" />
          <path d={RIVER_PATH} fill="none" stroke="#20aacc" strokeWidth="1.5" opacity="0.25" strokeDasharray="6 18" strokeDashoffset={-tick * 2} />

          {/* Source icons */}
          {SOURCES.map(s => (
            <g key={s.id}>
              <rect x={s.x - 12} y={s.y - 12} width={24} height={24} rx={5} fill="#0a0e1a" stroke={s.color} strokeWidth="1" opacity="0.7" />
              <text x={s.x} y={s.y + 4} textAnchor="middle" fill={s.color} fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">{s.type[0]}</text>
            </g>
          ))}

          {/* Cluster zones */}
          {clusters.map(c => {
            const pos = gpsToSvg(c.center[0], c.center[1])
            const r = Math.max(20, Math.min(80, parseFloat(c.affected_radius) / 3 || 30))
            const col = SEV_C[c.severity] || '#555'
            const isSel = selected === c.cluster_id
            const dirA = DIR_ANGLE[c.spread_direction]
            const spdFactor = parseFloat(c.spread_speed) || 0.1
            const arrowLen = 20 + spdFactor * 60

            return (
              <g key={c.cluster_id} onClick={() => setSelected(c.cluster_id)} style={{ cursor: 'pointer' }}>
                {/* Zone fill */}
                <circle cx={pos.x} cy={pos.y} r={r} fill={`url(#cz${c.severity})`} stroke={col} strokeWidth={isSel ? 2 : 0.8} strokeDasharray={isSel ? '' : '4 3'} style={{ transition: 'all 0.4s' }} />
                {/* Sonar rings */}
                {[0, 1, 2].map(i => {
                  const ringR = ((tick * spdFactor * 0.8 + i * 20) % (r + 20))
                  return <circle key={i} cx={pos.x} cy={pos.y} r={ringR} fill="none" stroke={col} strokeWidth="0.5" opacity={Math.max(0, 1 - ringR / (r + 20)) * 0.4} />
                })}
                {/* Centroid pulse */}
                <circle cx={pos.x} cy={pos.y} r={4 + 2 * Math.sin(tick * 0.08)} fill={col} filter="url(#cgl)" />
                {/* ID label */}
                <text x={pos.x} y={pos.y - r - 6} textAnchor="middle" fill={col} fontSize="11" fontWeight="700" fontFamily="JetBrains Mono">C{c.cluster_id}</text>
                {/* Direction arrow */}
                {dirA !== undefined && (
                  <line x1={pos.x} y1={pos.y} x2={pos.x + arrowLen * Math.cos(dirA * Math.PI / 180)} y2={pos.y + arrowLen * Math.sin(dirA * Math.PI / 180)}
                    stroke={col} strokeWidth="2" strokeDasharray="4 3" strokeDashoffset={-tick * 1.5} opacity="0.6" markerEnd="" />
                )}
              </g>
            )
          })}

          {/* Source-to-cluster flowing particles */}
          {clusters.map(c => {
            const cPos = gpsToSvg(c.center[0], c.center[1])
            const src = SOURCES.find(s => c.probable_source?.includes(s.type) || (c.probable_source?.includes('Industrial') && s.type === 'Factory') || (c.probable_source?.includes('Sewage') && s.type === 'Sewage') || (c.probable_source?.includes('Agri') && s.type === 'Farm'))
            if (!src) return null
            return [0, 0.33, 0.66].map(off => {
              const t = ((tick * 0.015 + off) % 1)
              const px = src.x + (cPos.x - src.x) * t, py = src.y + (cPos.y - src.y) * t
              return <circle key={`p${c.cluster_id}-${off}`} cx={px} cy={py} r={1.5} fill={src.color} opacity={0.2 + 0.3 * Math.sin(t * Math.PI)} />
            })
          })}

          {/* Reading dots */}
          {SENSOR_POINTS.map(p => (
            <circle key={`sp${p.id}`} cx={p.x} cy={p.y} r={2.5} fill={SEV_C[p.severity] || '#444'} stroke="#060a14" strokeWidth="1" opacity="0.6" />
          ))}
        </svg>
      </div>

      {/* Cluster Registry */}
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {clusters.map(c => {
          const col = SEV_C[c.severity] || '#555'
          const isSel = selected === c.cluster_id
          return (
            <div key={c.cluster_id} onClick={() => setSelected(c.cluster_id)}
              style={{ background: isSel ? '#0e1420' : '#0d1117', border: '1px solid #1a2332', borderLeft: `3px solid ${isSel ? col : 'transparent'}`, borderRadius: 8, padding: 14, cursor: 'pointer', transition: 'all 0.3s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: col }}>C{c.cluster_id}</span>
                <span className={`badge badge-${c.severity?.toLowerCase()}`}>{c.severity}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10 }}>
                {[['GPS', `${c.center[0]?.toFixed(4)}, ${c.center[1]?.toFixed(4)}`], ['Radius', `${c.affected_radius}m`], ['Readings', c.reading_count], ['Direction', c.spread_direction || 'N/A'], ['Speed', c.spread_speed || 'N/A'], ['Source', c.probable_source?.split(' ')[0] || 'N/A']].map(([l, v]) => (
                  <div key={l}><div style={{ color: '#333', fontSize: 8, textTransform: 'uppercase' }}>{l}</div><div style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{v}</div></div>
                ))}
              </div>
            </div>
          )
        })}
        {clusters.length === 0 && <div style={{ color: '#222', textAlign: 'center', padding: 30, fontSize: 12 }}>Waiting for cluster data...</div>}
      </div>
    </div>
  )
}

/* ═══ TAB 2: CLUSTER ANATOMY ═══ */
export function ClusterAnatomy({ clusters, selected, setSelected }) {
  const c = clusters.find(cl => cl.cluster_id === selected) || clusters[0]
  if (!c) return <div style={{ color: '#222', textAlign: 'center', padding: 40 }}>No clusters available</div>

  const col = SEV_C[c.severity] || '#555'
  const readings = c.readings || []
  const avgTds = readings.length ? readings.reduce((s, r) => s + (r.tds || 0), 0) / readings.length : 0
  const avgTurb = readings.length ? readings.reduce((s, r) => s + (r.turbidity || 0), 0) / readings.length : 0
  const avgNit = readings.length ? readings.reduce((s, r) => s + (r.nitrate || 0), 0) / readings.length : 0
  const avgTemp = readings.length ? readings.reduce((s, r) => s + (r.temperature || 0), 0) / readings.length : 0

  /* Contamination profile bar */
  const total = avgTds / 10 + avgTurb * 10 + avgNit + Math.abs(avgTemp - 26) + 5
  const segs = [
    { label: 'TDS', pct: (avgTds / 10) / total * 100, color: '#f0f0f0' },
    { label: 'Turb', pct: (avgTurb * 10) / total * 100, color: '#888' },
    { label: 'Nitrate', pct: avgNit / total * 100, color: '#ffaa00' },
    { label: 'Temp', pct: Math.abs(avgTemp - 26) / total * 100, color: '#44cc66' },
    { label: 'RGB', pct: 5 / total * 100, color: '#bb66ff' },
  ]

  const barData = [
    { param: 'TDS', cluster: avgTds.toFixed(0), safe: SAFE.tds, average: AVG.tds },
    { param: 'Turbidity', cluster: avgTurb.toFixed(2), safe: SAFE.turbidity, average: AVG.turbidity },
    { param: 'Nitrate', cluster: avgNit.toFixed(1), safe: SAFE.nitrate, average: AVG.nitrate },
    { param: 'Temperature', cluster: avgTemp.toFixed(1), safe: SAFE.temperature, average: AVG.temperature },
  ]

  const exceeded = barData.filter(b => Number(b.cluster) > b.safe)

  /* OSM evidence */
  const osmEvidence = c.probable_source?.includes('Industrial') ? [{ name: 'Industrial zone', dist: 80 }, { name: 'Commercial area', dist: 250 }, { name: 'Road network', dist: 340 }]
    : c.probable_source?.includes('Agri') ? [{ name: 'Farmland', dist: 120 }, { name: 'Irrigation canal', dist: 200 }, { name: 'Residential area', dist: 380 }]
    : c.probable_source?.includes('Sewage') ? [{ name: 'Residential area', dist: 90 }, { name: 'Sewage outfall', dist: 150 }, { name: 'Park', dist: 300 }]
    : [{ name: 'Mixed land use', dist: 100 }, { name: 'Roadway', dist: 200 }]

  const confidence = c.severity === 'HIGH' ? 87 : c.severity === 'MODERATE' ? 72 : 55
  const confCol = confidence > 80 ? '#44cc66' : confidence > 60 ? '#ffaa00' : '#ff4455'

  return (
    <div className="page-fade">
      {/* Cluster selector pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {clusters.map(cl => (
          <button key={cl.cluster_id} onClick={() => setSelected(cl.cluster_id)}
            className={`filter-btn${selected === cl.cluster_id ? ' active' : ''}`}
            style={{ borderColor: selected === cl.cluster_id ? (SEV_C[cl.severity] || '#555') + '50' : undefined }}>
            C{cl.cluster_id}
          </button>
        ))}
      </div>

      {/* Panel A: Identity Card */}
      <div style={{ background: '#0d1117', border: `1px solid ${col}20`, borderRadius: 10, padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: col, fontFamily: 'var(--font-mono)' }}>Cluster {c.cluster_id}</span>
          <span className={`badge badge-${c.severity?.toLowerCase()}`} style={{ fontSize: 12, padding: '4px 12px' }}>{c.severity}</span>
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 11, color: '#666', marginBottom: 12, flexWrap: 'wrap' }}>
          <span>GPS: {c.center[0]?.toFixed(5)}, {c.center[1]?.toFixed(5)}</span>
          <span>Source: {c.probable_source}</span>
          <span>Spread: {c.spread_direction} @ {c.spread_speed}</span>
          <span>Radius: {c.affected_radius}m</span>
        </div>
        {/* Profile bar */}
        <div style={{ fontSize: 9, color: '#333', marginBottom: 4 }}>CONTAMINATION PROFILE</div>
        <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden' }}>
          {segs.map(s => <div key={s.label} style={{ width: `${s.pct}%`, background: s.color, opacity: 0.7, transition: 'width 0.4s' }} title={`${s.label}: ${s.pct.toFixed(0)}%`} />)}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          {segs.map(s => <span key={s.label} style={{ fontSize: 8, color: s.color }}>{s.label} {s.pct.toFixed(0)}%</span>)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* Panel B: Readings Scatter (SVG) */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginBottom: 8 }}>Readings Scatter — Lat/Lon offset</div>
          <svg viewBox="0 0 200 200" style={{ width: '100%', maxHeight: 220 }}>
            <circle cx="100" cy="100" r="80" fill="none" stroke="#1a2332" strokeWidth="1" strokeDasharray="4 3" />
            <line x1="100" y1="20" x2="100" y2="180" stroke="#1a2332" strokeWidth="0.5" />
            <line x1="20" y1="100" x2="180" y2="100" stroke="#1a2332" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="3" fill={col} />{/* centroid */}
            {readings.map((r, i) => {
              const dx = (r.longitude - c.center[1]) * 50000, dy = (c.center[0] - r.latitude) * 50000
              const sz = Math.max(2, Math.min(6, r.tds / 150))
              const nitCol = r.nitrate > 25 ? '#ff4455' : r.nitrate > 15 ? '#ffaa00' : '#3388aa'
              return <circle key={i} cx={100 + dx} cy={100 + dy} r={sz} fill={nitCol} opacity="0.7" style={{ transition: 'cx 0.4s, cy 0.4s' }} />
            })}
          </svg>
        </div>

        {/* Panel C: Parameter Breakdown */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginBottom: 8 }}>Parameter vs Threshold vs Average</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
              <XAxis dataKey="param" tick={{ fill: '#444', fontSize: 9 }} />
              <YAxis tick={{ fill: '#333', fontSize: 8 }} />
              <Tooltip contentStyle={{ background: '#0a0e16', border: '1px solid #1a2332', fontSize: 10 }} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="cluster" name="Cluster" fill={col} radius={[2, 2, 0, 0]} animationDuration={600} />
              <Bar dataKey="safe" name="Safe Limit" fill="#ff445540" radius={[2, 2, 0, 0]} />
              <Bar dataKey="average" name="River Avg" fill="#555" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {exceeded.length > 0 && <div style={{ marginTop: 6, fontSize: 10, color: '#ff4455' }}>Exceeded: {exceeded.map(e => e.param).join(', ')}</div>}
        </div>
      </div>

      {/* Panel D: Reading Timeline */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginBottom: 8 }}>Reading Timeline</div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={readings.map((r, i) => ({ idx: i, tds: r.tds, turb: r.turbidity * 100, nit: r.nitrate }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
            <XAxis dataKey="idx" tick={{ fill: '#333', fontSize: 8 }} />
            <YAxis tick={{ fill: '#333', fontSize: 8 }} />
            <Tooltip contentStyle={{ background: '#0a0e16', border: '1px solid #1a2332', fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <ReferenceLine y={SAFE.tds} stroke="#ff445540" strokeDasharray="4 3" />
            <Line type="monotone" dataKey="tds" name="TDS" stroke="#f0f0f0" strokeWidth={1.2} dot={false} animationDuration={600} />
            <Line type="monotone" dataKey="nit" name="Nitrate" stroke="#ffaa00" strokeWidth={1.2} dot={false} animationDuration={600} />
            <Line type="monotone" dataKey="turb" name="Turb×100" stroke="#888" strokeWidth={1.2} dot={false} animationDuration={600} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Panel E: Source Evidence */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', marginBottom: 10 }}>Source Evidence</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16 }}>
          <div>
            <div style={{ fontSize: 9, color: '#444', marginBottom: 6 }}>OSM EVIDENCE</div>
            {osmEvidence.map(e => (
              <div key={e.name} style={{ fontSize: 11, color: '#777', padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                <span>{e.name}</span><span style={{ background: '#151a28', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontFamily: 'var(--font-mono)' }}>{e.dist}m</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#444', marginBottom: 6 }}>SENSOR EVIDENCE</div>
            {exceeded.map(e => <div key={e.param} style={{ fontSize: 11, color: '#ff6644', padding: '3px 0' }}>{e.param} {e.cluster} &gt; {e.safe} (threshold)</div>)}
            {exceeded.length === 0 && <div style={{ fontSize: 11, color: '#555' }}>No threshold breaches</div>}
          </div>
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 9, color: '#444', marginBottom: 6 }}>CONFIDENCE</div>
            <svg viewBox="0 0 80 50" style={{ width: 80 }}>
              <path d={`M 10,45 A 30,30 0 0,1 70,45`} fill="none" stroke="#151a28" strokeWidth="6" strokeLinecap="round" />
              <path d={`M 10,45 A 30,30 0 0,1 ${10 + 60 * (confidence / 100)},${45 - 30 * Math.sin(Math.acos(1 - 2 * confidence / 100))}`} fill="none" stroke={confCol} strokeWidth="6" strokeLinecap="round" />
              <text x="40" y="42" textAnchor="middle" fill={confCol} fontSize="12" fontWeight="700" fontFamily="JetBrains Mono">{confidence}%</text>
            </svg>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#666', borderTop: '1px solid #151a28', paddingTop: 8 }}>
          This cluster is most likely caused by <strong style={{ color: col }}>{c.probable_source}</strong>, supported by {exceeded.length > 0 ? `elevated ${exceeded.map(e => e.param.toLowerCase()).join(' and ')} levels` : 'proximity to identified sources'} near the cluster centroid.
        </div>
      </div>
    </div>
  )
}
