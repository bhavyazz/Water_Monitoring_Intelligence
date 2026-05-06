import { useState, useEffect, useMemo } from 'react'
import { SOURCES, RIVER_PATH, SENSOR_POINTS } from '../data/syntheticData'

const SEV = { high: '#ff4455', moderate: '#ffaa00', low: '#44cc66' }

/* Generate 168 time steps (7 days × 24 hours) with diurnal patterns */
function genTimeline() {
  const steps = []
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const isWeekend = d >= 5
      const diurnal = Math.sin((h - 6) * Math.PI / 12) // peaks ~noon
      const morning = h >= 6 && h <= 9 ? 1.3 : 1
      const evening = h >= 17 && h <= 20 ? 1.2 : 1
      const rain = (d === 2 && h >= 14 && h <= 18) || (d === 5 && h >= 8 && h <= 12)
      const rainMult = rain ? 1.8 : 1

      const baseNit = isWeekend ? 8 : 15
      const baseTds = 350
      const contam = (baseNit * morning * evening * rainMult + diurnal * 5 + Math.random() * 3)

      steps.push({
        day: d, hour: h, idx: d * 24 + h,
        label: `Day ${d + 1}, ${String(h).padStart(2, '0')}:00`,
        dayLabel: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d],
        nitrate: Math.max(2, contam),
        tds: baseTds + contam * 12 * rainMult + Math.random() * 20,
        turbidity: 1.5 + contam * 0.08 * rainMult + Math.random() * 0.3,
        temperature: 24 + 5 * Math.sin((h - 3) * Math.PI / 12) + Math.random() * 0.5,
        rain,
        contamScore: contam * rainMult,
      })
    }
  }
  return steps
}

/* Events log */
function genEvents(timeline) {
  const evts = []
  timeline.forEach((t, i) => {
    if (t.rain && (i === 0 || !timeline[i - 1].rain)) evts.push({ idx: t.idx, type: 'rain', label: t.label, msg: 'Rain event started — surface runoff increasing' })
    if (!t.rain && i > 0 && timeline[i - 1].rain) evts.push({ idx: t.idx, type: 'rain-end', label: t.label, msg: 'Rain event ended — monitoring residual runoff' })
    if (t.nitrate > 22 && (i === 0 || timeline[i - 1].nitrate <= 22)) evts.push({ idx: t.idx, type: 'spike', label: t.label, msg: `Nitrate spike detected (${t.nitrate.toFixed(1)} ppm). Probable cause: ${t.hour < 10 ? 'morning irrigation' : 'evening discharge'}` })
    if (t.contamScore > 30 && (i === 0 || timeline[i - 1].contamScore <= 30)) evts.push({ idx: t.idx, type: 'danger', label: t.label, msg: `Contamination score exceeded critical threshold (${t.contamScore.toFixed(0)})` })
  })
  return evts
}

const TIMELINE = genTimeline()
const EVENTS = genEvents(TIMELINE)
const worstIdx = TIMELINE.reduce((best, t, i) => t.contamScore > TIMELINE[best].contamScore ? i : best, 0)

export default function RiverTimeline() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tick, setTick] = useState(0)

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 50); return () => clearInterval(id) }, [])

  useEffect(() => {
    if (!playing) return
    if (step >= 167) { setPlaying(false); return }
    const d = Math.max(20, 200 / speed)
    const t = setTimeout(() => setStep(s => Math.min(167, s + 1)), d)
    return () => clearTimeout(t)
  }, [playing, step, speed])

  const cur = TIMELINE[step]
  const progress = step / 167

  /* Compute point states at current timestep */
  const points = useMemo(() => SENSOR_POINTS.map(p => {
    const mult = cur.contamScore / 15
    const sev = p.severity === 'high' && mult > 1.2 ? 'high' : p.severity === 'moderate' || mult > 0.8 ? 'moderate' : 'low'
    const plumeR = (p.spread === 'CONCENTRATED' ? 18 : p.spread === 'LINEAR' ? 14 : 25) * Math.min(2, mult * 0.6)
    return { ...p, sev, plumeR, plumeRx: p.spread === 'LINEAR' ? plumeR * 2.5 : plumeR * 1.2 }
  }), [cur])

  const visibleEvents = EVENTS.filter(e => e.idx <= step).slice(-8)

  /* Minimap: thin color strip showing contamScore over time */
  const miniColors = useMemo(() => TIMELINE.map(t => {
    const n = Math.min(1, t.contamScore / 35)
    return `rgb(${Math.round(n * 255)}, ${Math.round((1 - n) * 150)}, ${Math.round((1 - n) * 80)})`
  }), [])

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>River Timeline</h2>
        <p>7-day historical replay with diurnal patterns and rain events</p>
      </div>

      {/* Rain banner */}
      {cur.rain && (
        <div style={{ background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: 8, padding: '8px 16px', marginBottom: 12, fontSize: 12, color: '#4499cc', display: 'flex', alignItems: 'center', gap: 8, animation: 'fadeSlideUp 0.3s ease' }}>
          <span style={{ fontSize: 16 }}>~</span> Rain event — surface runoff increased
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14, height: 'calc(100vh - 320px)' }}>
        {/* SVG River */}
        <div style={{ background: '#060a14', borderRadius: 12, border: '1px solid #1a2332', overflow: 'hidden' }}>
          <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="rtg" x1="0%" x2="100%"><stop offset="0%" stopColor="#082840" /><stop offset="100%" stopColor="#0a4060" /></linearGradient>
              <radialGradient id="rtH"><stop offset="0%" stopColor="#ff4455" stopOpacity="0.4" /><stop offset="100%" stopColor="#ff4455" stopOpacity="0" /></radialGradient>
              <radialGradient id="rtM"><stop offset="0%" stopColor="#ffaa00" stopOpacity="0.3" /><stop offset="100%" stopColor="#ffaa00" stopOpacity="0" /></radialGradient>
              <filter id="rtg2"><feGaussianBlur stdDeviation="3" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <path d={RIVER_PATH} fill="none" stroke="#051525" strokeWidth="36" strokeLinecap="round" opacity="0.8" />
            <path d={RIVER_PATH} fill="none" stroke="url(#rtg)" strokeWidth="24" strokeLinecap="round" />
            <path d={RIVER_PATH} fill="none" stroke="#1a7a9a" strokeWidth="10" strokeLinecap="round" opacity="0.4" />
            {/* Flow speed varies with rain */}
            <path d={RIVER_PATH} fill="none" stroke="#20aacc" strokeWidth="2" opacity="0.3" strokeDasharray="6 18" strokeDashoffset={-tick * (cur.rain ? 4 : 2)} />
            {/* Rain streaks */}
            {cur.rain && Array.from({ length: 20 }).map((_, i) => {
              const x = 50 + ((tick * 3 + i * 55) % 1050), y = ((tick * 2 + i * 20) % 400)
              return <line key={`rn${i}`} x1={x} y1={y} x2={x - 3} y2={y + 12} stroke="#4499cc" strokeWidth="0.8" opacity="0.3" />
            })}
            {/* Plumes */}
            {points.filter(p => p.sev !== 'low').map(p => (
              <ellipse key={`pl${p.id}`} cx={p.x} cy={p.y} rx={p.plumeRx} ry={p.plumeR}
                fill={p.sev === 'high' ? 'url(#rtH)' : 'url(#rtM)'} opacity={0.6 + 0.2 * Math.sin(tick * 0.04 + p.id)} />
            ))}
            {/* Source labels */}
            {SOURCES.map(s => (
              <g key={s.id}><rect x={s.x - 12} y={s.y - 12} width={24} height={24} rx={5} fill="#0a0e1a" stroke={s.color} strokeWidth="1" opacity="0.7" />
                <text x={s.x} y={s.y + 4} textAnchor="middle" fill={s.color} fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">{s.type[0]}</text></g>
            ))}
            {/* Sensor points */}
            {points.map(p => (
              <circle key={`sp${p.id}`} cx={p.x} cy={p.y} r={4.5} fill={SEV[p.sev]} stroke="#060a14" strokeWidth="1.5" filter="url(#rtg2)" />
            ))}
            {/* Timestamp */}
            <text x="1060" y="30" textAnchor="end" fill="#555" fontSize="14" fontWeight="600" fontFamily="JetBrains Mono">{cur.label}</text>
            <text x="1060" y="46" textAnchor="end" fill="#333" fontSize="10">{cur.dayLabel}</text>
          </svg>
        </div>

        {/* Event Log */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Event Log</div>
          {visibleEvents.length === 0 && <div style={{ color: '#222', fontSize: 12, padding: 20, textAlign: 'center' }}>Scrub timeline to see events</div>}
          {visibleEvents.map((e, i) => (
            <div key={i} className="page-fade" style={{ padding: '8px 0', borderBottom: '1px solid #151a28', fontSize: 11 }}>
              <div style={{ color: e.type === 'danger' ? '#ff4455' : e.type === 'spike' ? '#ffaa00' : '#4499cc', fontWeight: 600, fontSize: 10, marginBottom: 2 }}>{e.label}</div>
              <div style={{ color: '#777' }}>{e.msg}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Minimap + controls */}
      <div style={{ marginTop: 12, background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: '12px 16px' }}>
        {/* Contamination minimap */}
        <div style={{ height: 20, display: 'flex', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
          {miniColors.map((c, i) => (
            <div key={i} style={{ flex: 1, background: c, opacity: i === step ? 1 : 0.7, cursor: 'pointer', position: 'relative' }} onClick={() => setStep(i)}>
              {EVENTS.some(e => e.idx === i && e.type === 'spike') && <div style={{ position: 'absolute', top: 0, left: '50%', width: 2, height: '100%', background: '#ffaa00', opacity: 0.8 }} />}
            </div>
          ))}
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="filter-btn" onClick={() => setPlaying(!playing)} style={{ minWidth: 60 }}>{playing ? 'Pause' : 'Play'}</button>
          <button className="filter-btn" onClick={() => { setStep(0); setPlaying(false) }}>Reset</button>
          {[1, 4, 16].map(s => <button key={s} className={`filter-btn${speed === s ? ' active' : ''}`} onClick={() => setSpeed(s)} style={{ minWidth: 32 }}>{s}x</button>)}
          <button className="filter-btn" onClick={() => setStep(worstIdx)} style={{ color: '#ff4455' }}>Jump to Worst</button>
          <input type="range" min={0} max={167} value={step} onChange={e => setStep(+e.target.value)} style={{ flex: 1, accentColor: '#00d4ff' }} />
          <span style={{ fontFamily: 'var(--font-mono)', color: '#888', fontSize: 12, minWidth: 40 }}>{cur.dayLabel} {String(cur.hour).padStart(2, '0')}h</span>
        </div>
      </div>
    </div>
  )
}
