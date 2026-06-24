import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet'
import { fetchClusters, fetchHistory } from '../api'
import { SOURCES, RIVER_PATH, SENSOR_POINTS } from '../data/syntheticData'
import { useActiveLocation } from '../locationProvider'
import 'leaflet/dist/leaflet.css'

/* ── Constants ────────────────────────────────────────────────── */
const SEV = { high: '#ff4455', moderate: '#ffaa00', low: '#44cc66' }
const DIR_BEARING = { North: 0, 'North-East': 45, East: 90, 'South-East': 135, South: 180, 'South-West': 225, West: 270, 'North-West': 315 }

function arrowEnd(lat, lon, deg, km) {
  const R = 6371, d = km / R, b = (deg * Math.PI) / 180
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b))
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2))
  return [(la2 * 180) / Math.PI, (lo2 * 180) / Math.PI]
}

const sevColor = s => s === 'HIGH' ? '#ff4455' : s === 'MODERATE' ? '#ffaa00' : '#44cc66'

function AutoFit({ positions }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (positions.length > 0 && !fitted.current) {
      map.fitBounds(positions, { padding: [40, 40], maxZoom: 16 })
      fitted.current = true
    }
  }, [positions, map])
  return null
}

/* ── Floating particles along the SVG river ──────────────────── */
function useParticles(count, tick) {
  return useMemo(() => {
    const pts = []
    for (let i = 0; i < count; i++) {
      const t = ((tick * 0.008 + i / count) % 1)
      // approximate position along cubic bezier river
      const x = 40 + t * 1020
      const yBase = 300 - 80 * Math.sin(t * Math.PI * 2.5) + 30 * Math.cos(t * Math.PI * 1.7)
      const wobble = Math.sin(tick * 0.03 + i * 2) * 8
      pts.push({ x, y: yBase + wobble, opacity: 0.15 + 0.15 * Math.sin(tick * 0.05 + i) })
    }
    return pts
  }, [count, tick])
}

/* ── Main Component ──────────────────────────────────────────── */
export default function SpreadTracker() {
  const [tab, setTab] = useState(0)
  const [clusters, setClusters] = useState([])
  const [readings, setReadings] = useState([])
  const [selectedCluster, setSelectedCluster] = useState(null)

  const latestGPS = readings.find(r => r.latitude && r.longitude)
  const [baseLat, baseLon, locationSource] = useActiveLocation(latestGPS?.latitude, latestGPS?.longitude)
  const defaultCenter = [baseLat, baseLon]

  // Simulation state
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1) // 1x, 2x, 4x
  const [tick, setTick] = useState(0)
  const [simSelected, setSimSelected] = useState(null)

  /* Data fetching */
  useEffect(() => {
    const load = () => {
      fetchClusters().then(d => setClusters(d?.clusters || [])).catch(() => {})
      fetchHistory(200).then(d => setReadings(d?.readings || [])).catch(() => {})
    }
    load()
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
  }, [])

  /* Animation tick */
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 40)
    return () => clearInterval(id)
  }, [])

  /* Playback engine */
  useEffect(() => {
    if (!playing) return
    if (hour >= 72) { setPlaying(false); return }
    const delay = Math.max(30, 100 / speed)
    const t = setTimeout(() => setHour(h => Math.min(72, h + 0.5)), delay)
    return () => clearTimeout(t)
  }, [playing, hour, speed])

  const positions = clusters.map(c => [c.center[0], c.center[1]])
  const arrows = useMemo(() => clusters.map(c => {
    const b = DIR_BEARING[c.spread_direction] ?? null
    return b !== null ? { id: c.cluster_id, start: c.center, end: arrowEnd(c.center[0], c.center[1], b, 0.08), color: sevColor(c.severity), dir: c.spread_direction, spd: c.spread_speed } : null
  }).filter(Boolean), [clusters])

  /* Simulation plumes — grow with time, different spread shapes */
  const plumes = useMemo(() => SENSOR_POINTS.filter(p => p.severity !== 'low').map(p => {
    const progress = Math.min(1, hour / 48)
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2 // easeInOutQuad
    const baseR = p.spread === 'CONCENTRATED' ? 22 : p.spread === 'LINEAR' ? 16 : 28
    const r = baseR * (0.2 + eased * 0.8)
    const downstream = eased * (p.spread === 'LINEAR' ? 25 : p.spread === 'DIFFUSE' ? 12 : 5)
    return {
      ...p, r,
      rx: p.spread === 'LINEAR' ? r * 3 : p.spread === 'DIFFUSE' ? r * 1.5 : r,
      ry: p.spread === 'CONCENTRATED' ? r * 0.7 : r,
      dx: downstream,
      opacity: 0.15 + eased * 0.35,
    }
  }), [hour])

  /* Merge zones — nearby plumes merge after enough time */
  const mergeZones = useMemo(() => {
    if (hour < 20) return []
    const zones = []
    const progress = Math.min(1, (hour - 20) / 30)
    // Cluster 1 merge (points 2,3,4 near Factory)
    zones.push({ cx: 230, cy: 230, rx: 80 + progress * 40, ry: 25 + progress * 10, color: '#ff4455', opacity: 0.04 + progress * 0.06 })
    // Cluster 2 merge (points 5,6,7 near Farm)
    if (hour > 30) {
      const p2 = Math.min(1, (hour - 30) / 25)
      zones.push({ cx: 460, cy: 250, rx: 70 + p2 * 50, ry: 22 + p2 * 12, color: '#ffaa00', opacity: 0.03 + p2 * 0.05 })
    }
    return zones
  }, [hour])

  const particles = useParticles(30, tick)

  /* Sim stats */
  const affectedKm = (hour * 0.18).toFixed(1)
  const dangerPts = plumes.filter(p => p.severity === 'high' && hour > 3).length
  const warnPts = plumes.filter(p => p.severity === 'moderate' && hour > 3).length
  const riskLevel = hour > 50 ? 'CRITICAL' : hour > 30 ? 'HIGH' : hour > 12 ? 'MODERATE' : 'LOW'
  const riskCol = { CRITICAL: '#ff4455', HIGH: '#ff6644', MODERATE: '#ffaa00', LOW: '#44cc66' }[riskLevel]
  const contamPct = Math.min(100, (hour / 72 * 85 + Math.random() * 2)).toFixed(0)

  const selPt = simSelected !== null ? SENSOR_POINTS.find(p => p.id === simSelected) : null

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Spread Tracker</h2>
        <p>Real-time pollution movement tracking and time-lapse spread simulation [Source: {locationSource}]</p>
      </div>

      {/* Tab bar */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <button className={`filter-btn${tab === 0 ? ' active' : ''}`} onClick={() => setTab(0)}>Live Tracking</button>
        <button className={`filter-btn${tab === 1 ? ' active' : ''}`} onClick={() => setTab(1)}>Spread Simulation</button>
        {tab === 0 && <span className="live-indicator" style={{ marginLeft: 'auto' }}><span className="live-dot" /> Live</span>}
      </div>

      {/* ═══════════════ TAB 0: LIVE MAP ═══════════════ */}
      {tab === 0 && (
        <div className="page-fade">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, height: 'calc(100vh - 280px)' }}>
            {/* Leaflet map */}
            <div className="map-container" style={{ height: '100%' }}>
              <MapContainer key={`${baseLat}-${baseLon}`} center={defaultCenter} zoom={15} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; CARTO' />
                {positions.length > 0 && <AutoFit positions={positions} />}

                {/* Reading dots */}
                {readings.filter(r => r.latitude && r.longitude).map((r, i) => (
                  <CircleMarker key={`rd-${i}`} center={[r.latitude, r.longitude]} radius={2}
                    pathOptions={{ fillColor: '#2090b0', fillOpacity: 0.4, color: '#2090b0', weight: 0.5, opacity: 0.2 }} />
                ))}

                {/* Cluster zones */}
                {clusters.map(c => (
                  <Circle key={`zone-${c.cluster_id}`} center={c.center}
                    radius={parseFloat(c.affected_radius) || 60}
                    pathOptions={{ color: sevColor(c.severity), fillColor: sevColor(c.severity), fillOpacity: 0.06, weight: 1.5, dashArray: '8 4' }}
                    eventHandlers={{ click: () => setSelectedCluster(c) }}>
                    <Popup><div><strong>Cluster {c.cluster_id}</strong><br/>Severity: {c.severity}<br/>Direction: {c.spread_direction}<br/>Speed: {c.spread_speed}<br/>Source: {c.probable_source}<br/>Readings: {c.reading_count}</div></Popup>
                  </Circle>
                ))}

                {/* Cluster centers */}
                {clusters.map(c => (
                  <CircleMarker key={`cc-${c.cluster_id}`} center={c.center} radius={6}
                    pathOptions={{ fillColor: sevColor(c.severity), fillOpacity: 1, color: '#000', weight: 2 }} />
                ))}

                {/* Direction arrows */}
                {arrows.map(a => (
                  <Polyline key={`ar-${a.id}`} positions={[a.start, a.end]}
                    pathOptions={{ color: a.color, weight: 3, opacity: 0.8 }}>
                    <Popup><div>Direction: {a.dir}<br/>Speed: {a.spd}</div></Popup>
                  </Polyline>
                ))}
                {arrows.map(a => (
                  <CircleMarker key={`ah-${a.id}`} center={a.end} radius={4}
                    pathOptions={{ fillColor: a.color, fillOpacity: 1, color: a.color, weight: 2 }} />
                ))}
              </MapContainer>
            </div>

            {/* Side panel */}
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: '#444', marginBottom: 4 }}>{clusters.length} cluster{clusters.length !== 1 ? 's' : ''} detected</div>

              {clusters.map(c => {
                const isActive = selectedCluster?.cluster_id === c.cluster_id
                return (
                  <div key={c.cluster_id} onClick={() => setSelectedCluster(c)}
                    style={{ background: isActive ? '#12182a' : '#0d1117', border: `1px solid ${isActive ? sevColor(c.severity) + '40' : '#1a1a2e'}`, borderRadius: 10, padding: 16, cursor: 'pointer', transition: 'all 0.3s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>Cluster {c.cluster_id}</span>
                      <span className={`badge badge-${c.severity?.toLowerCase()}`}>{c.severity}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[['Direction', c.spread_direction], ['Speed', c.spread_speed], ['Source', c.probable_source?.split(' ')[0]], ['Radius', c.affected_radius]].map(([l, v]) => (
                        <div key={l}>
                          <div style={{ fontSize: 9, color: '#333', textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</div>
                          <div style={{ fontSize: 12, color: '#888', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{v || 'N/A'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {clusters.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#222', fontSize: 12 }}>Collecting cluster data...</div>}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ TAB 1: SIMULATION ═══════════════ */}
      {tab === 1 && (
        <div className="page-fade">
          {/* Controls bar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, padding: '10px 16px', background: '#0d1117', borderRadius: 10, border: '1px solid #1a1a2e' }}>
            <button className="filter-btn" onClick={() => setPlaying(!playing)} style={{ minWidth: 65, background: playing ? '#1a1520' : undefined, borderColor: playing ? '#ff445540' : undefined }}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button className="filter-btn" onClick={() => { setHour(0); setPlaying(false); setSimSelected(null) }}>Reset</button>

            {/* Speed selector */}
            {[1, 2, 4].map(s => (
              <button key={s} className={`filter-btn${speed === s ? ' active' : ''}`} onClick={() => setSpeed(s)} style={{ minWidth: 36, padding: '5px 8px' }}>
                {s}x
              </button>
            ))}

            {/* Timeline slider */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: '#333' }}>0h</span>
              <input type="range" min={0} max={72} step={0.5} value={hour} onChange={e => setHour(+e.target.value)}
                style={{ flex: 1, accentColor: riskCol, height: 4 }} />
              <span style={{ fontSize: 10, color: '#333' }}>72h</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', color: riskCol, fontSize: 16, fontWeight: 700, minWidth: 50, textAlign: 'right' }}>{hour.toFixed(0)}h</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 14 }}>
            {/* SVG River Animation */}
            <div style={{ background: '#060a14', borderRadius: 12, border: '1px solid #1a1a2e', overflow: 'hidden', height: 'calc(100vh - 360px)' }}>
              <svg viewBox="0 0 1100 400" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
                <defs>
                  <linearGradient id="rvGrad" x1="0%" x2="100%"><stop offset="0%" stopColor="#082840" /><stop offset="100%" stopColor="#0a4060" /></linearGradient>
                  <radialGradient id="plH"><stop offset="0%" stopColor="#ff4455" stopOpacity="0.45" /><stop offset="100%" stopColor="#ff4455" stopOpacity="0" /></radialGradient>
                  <radialGradient id="plM"><stop offset="0%" stopColor="#ffaa00" stopOpacity="0.35" /><stop offset="100%" stopColor="#ffaa00" stopOpacity="0" /></radialGradient>
                  <radialGradient id="plL"><stop offset="0%" stopColor="#44cc66" stopOpacity="0.2" /><stop offset="100%" stopColor="#44cc66" stopOpacity="0" /></radialGradient>
                  <filter id="glw"><feGaussianBlur stdDeviation="3" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  <filter id="glw2"><feGaussianBlur stdDeviation="6" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>

                {/* River bed (wide shadow) */}
                <path d={RIVER_PATH} fill="none" stroke="#051525" strokeWidth="36" strokeLinecap="round" opacity="0.8" />
                {/* River body */}
                <path d={RIVER_PATH} fill="none" stroke="url(#rvGrad)" strokeWidth="24" strokeLinecap="round" />
                {/* River surface highlight */}
                <path d={RIVER_PATH} fill="none" stroke="#1a7a9a" strokeWidth="10" strokeLinecap="round" opacity="0.4" />
                {/* Animated flow */}
                <path d={RIVER_PATH} fill="none" stroke="#20aacc" strokeWidth="2" opacity="0.35" strokeDasharray="6 18" strokeDashoffset={-tick * 2.5} />
                <path d={RIVER_PATH} fill="none" stroke="#40ccee" strokeWidth="1" opacity="0.2" strokeDasharray="3 25" strokeDashoffset={-tick * 3 + 10} />

                {/* Water particles */}
                {particles.map((p, i) => (
                  <circle key={`wp${i}`} cx={p.x} cy={p.y} r={1.2} fill="#40ccee" opacity={p.opacity} />
                ))}

                {/* Merge zones */}
                {mergeZones.map((z, i) => (
                  <ellipse key={`mz${i}`} cx={z.cx} cy={z.cy} rx={z.rx} ry={z.ry} fill={z.color} opacity={z.opacity * (0.8 + 0.2 * Math.sin(tick * 0.03 + i))} />
                ))}

                {/* Pollution plumes */}
                {plumes.map(p => (
                  <ellipse key={`pl-${p.id}`} cx={p.x + p.dx} cy={p.y}
                    rx={p.rx} ry={p.ry}
                    fill={p.severity === 'high' ? 'url(#plH)' : 'url(#plM)'}
                    opacity={p.opacity * (0.75 + 0.25 * Math.sin(tick * 0.035 + p.id * 0.7))} />
                ))}

                {/* Connection lines from sensor to source (appear progressively) */}
                {SENSOR_POINTS.filter(p => p.sourceId && hour > 2).map(p => {
                  const src = SOURCES.find(s => s.id === p.sourceId)
                  if (!src) return null
                  const lineOpacity = Math.min(0.3, (hour - 2) / 20)
                  return <line key={`cn-${p.id}`} x1={p.x} y1={p.y} x2={src.x} y2={src.y}
                    stroke={src.color} strokeWidth="0.8" opacity={lineOpacity} strokeDasharray="4 3" strokeDashoffset={-tick * 1} />
                })}

                {/* Source icons */}
                {SOURCES.map(s => (
                  <g key={`src-${s.id}`}>
                    <rect x={s.x - 14} y={s.y - 14} width={28} height={28} rx={6} fill="#0a0e1a" stroke={s.color} strokeWidth="1.2" opacity="0.8" />
                    <text x={s.x} y={s.y + 4} textAnchor="middle" fill={s.color} fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">{s.type[0]}</text>
                    <text x={s.x} y={s.y + 25} textAnchor="middle" fill="#333" fontSize="7" fontFamily="Inter">{s.label}</text>
                  </g>
                ))}

                {/* Sensor points */}
                {SENSOR_POINTS.map(p => {
                  const c = SEV[p.severity]
                  const isSel = simSelected === p.id
                  const pulseR = hour > 3 && p.severity !== 'low' ? 6 + 3 * Math.sin(tick * 0.06 + p.id * 0.5) : 0
                  return (
                    <g key={`pt-${p.id}`} onClick={() => setSimSelected(p.id)} style={{ cursor: 'pointer' }}>
                      {pulseR > 0 && <circle cx={p.x} cy={p.y} r={pulseR + 5} fill={c} opacity={0.08} />}
                      {pulseR > 0 && <circle cx={p.x} cy={p.y} r={pulseR} fill={c} opacity={0.15} />}
                      <circle cx={p.x} cy={p.y} r={isSel ? 6 : 4} fill={c} stroke={isSel ? '#fff' : '#060a14'} strokeWidth={isSel ? 2 : 1.5} filter="url(#glw)" />
                    </g>
                  )
                })}

                {/* Time indicator */}
                <text x="1060" y="30" textAnchor="end" fill={riskCol} fontSize="18" fontWeight="700" fontFamily="JetBrains Mono" opacity="0.6">{hour.toFixed(0)}h</text>
                <text x="1060" y="46" textAnchor="end" fill="#333" fontSize="9" fontFamily="Inter">elapsed</text>
              </svg>
            </div>

            {/* Right panel: stats + point detail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Risk badge */}
              <div style={{ background: '#0d1117', border: `1px solid ${riskCol}25`, borderRadius: 10, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Simulation Risk</div>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: riskCol }}>{riskLevel}</div>
              </div>

              {/* Stats cards */}
              {[
                { l: 'Affected Length', v: `${affectedKm} km`, c: '#2090b0' },
                { l: 'Danger Points', v: dangerPts, c: '#ff4455' },
                { l: 'Warning Points', v: warnPts, c: '#ffaa00' },
                { l: 'Contamination', v: `${hour > 0 ? contamPct : 0}%`, c: '#bb66ff' },
              ].map(s => (
                <div key={s.l} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 9, color: '#333', textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.l}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.c, marginTop: 2 }}>{s.v}</div>
                </div>
              ))}

              {/* Selected point detail */}
              {selPt && (
                <div className="page-fade" key={selPt.id} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 8, padding: 14, marginTop: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Point #{selPt.id}</span>
                    <span className={`badge badge-${selPt.severity}`}>{selPt.severity.toUpperCase()}</span>
                  </div>
                  {[['Spread', selPt.spread], ['TDS', `${selPt.tds} ppm`], ['Nitrate', `${selPt.nitrate} ppm`], ['Temp', `${selPt.temp} °C`]].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #151a28' }}>
                      <span style={{ color: '#333' }}>{l}</span>
                      <span style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
