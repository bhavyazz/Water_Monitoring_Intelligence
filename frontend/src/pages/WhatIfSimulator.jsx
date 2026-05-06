import { useState, useEffect, useMemo } from 'react'
import { SOURCES, RIVER_PATH, SENSOR_POINTS } from '../data/syntheticData'

const PRESETS = [
  { label: 'Normal', values: { Factory: 100, Farm: 100, Sewage: 100, Landfill: 100 } },
  { label: 'Weekend', values: { Factory: 20, Farm: 50, Sewage: 80, Landfill: 100 } },
  { label: 'Monsoon', values: { Factory: 150, Farm: 150, Sewage: 150, Landfill: 150 } },
  { label: 'Industrial Accident', values: { Factory: 500, Farm: 100, Sewage: 100, Landfill: 100 } },
  { label: 'Drought', values: { Factory: 200, Farm: 200, Sewage: 200, Landfill: 200 } },
]

const WHO_LIMITS = { tds: 500, turbidity: 4, nitrate: 50, bloom: 60 }
const BASE = { tds: 350, turbidity: 2, nitrate: 12, bloom: 25, health: 75 }

/* Source contribution weights per parameter */
const WEIGHTS = {
  tds:       { Factory: 0.35, Farm: 0.15, Sewage: 0.25, Landfill: 0.25 },
  turbidity: { Factory: 0.25, Farm: 0.20, Sewage: 0.35, Landfill: 0.20 },
  nitrate:   { Factory: 0.15, Farm: 0.50, Sewage: 0.25, Landfill: 0.10 },
  bloom:     { Factory: 0.10, Farm: 0.45, Sewage: 0.30, Landfill: 0.15 },
}

function useAnim(target, ms = 400) {
  const [v, setV] = useState(target)
  useEffect(() => {
    let raf; const s = v, d = target - s, t0 = Date.now()
    const step = () => { const p = Math.min(1, (Date.now() - t0) / ms); setV(s + d * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

export default function WhatIfSimulator() {
  const [sliders, setSliders] = useState({ Factory: 100, Farm: 100, Sewage: 100, Landfill: 100 })
  const [tick, setTick] = useState(0)

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 50); return () => clearInterval(id) }, [])

  const setSlider = (key, val) => setSliders(s => ({ ...s, [key]: val }))
  const applyPreset = (p) => setSliders(p.values)

  /* Compute predicted impact from linear mixing model */
  const predicted = useMemo(() => {
    const mix = (param) => {
      const w = WEIGHTS[param]
      let total = 0
      for (const src of Object.keys(w)) total += w[src] * (sliders[src] / 100)
      return BASE[param] * total
    }
    const tds = mix('tds'), turb = mix('turbidity'), nit = mix('nitrate'), bloom = mix('bloom')
    const health = Math.max(0, Math.min(100, 100 - tds / 10 - turb * 10 - nit * 1.5))
    return { tds, turbidity: turb, nitrate: nit, bloom, health }
  }, [sliders])

  const aTds = useAnim(predicted.tds)
  const aTurb = useAnim(predicted.turbidity)
  const aNit = useAnim(predicted.nitrate)
  const aBloom = useAnim(predicted.bloom)
  const aHealth = useAnim(predicted.health)

  /* Days until breach */
  const daysUntil = (current, limit) => current >= limit ? 0 : Math.max(0.1, ((limit - current) / (current * 0.02 + 0.1))).toFixed(1)

  const anyExceeded = aTds > WHO_LIMITS.tds || aTurb > WHO_LIMITS.turbidity || aNit > WHO_LIMITS.nitrate

  /* Generate report text */
  const reportText = `What-If Scenario Report\n\nSource Settings: ${Object.entries(sliders).map(([k, v]) => `${k}: ${v}%`).join(', ')}\n\nPredicted Values:\n- TDS: ${aTds.toFixed(0)} ppm (WHO: ${WHO_LIMITS.tds})\n- Turbidity: ${aTurb.toFixed(2)} NTU (WHO: ${WHO_LIMITS.turbidity})\n- Nitrate: ${aNit.toFixed(1)} ppm (WHO: ${WHO_LIMITS.nitrate})\n- Bloom Risk: ${aBloom.toFixed(0)}%\n- Health Score: ${aHealth.toFixed(0)}/100\n\n${anyExceeded ? 'WARNING: One or more parameters exceed WHO guidelines.' : 'All parameters within safe limits.'}`

  /* Plume scaling based on sliders */
  const pointMults = useMemo(() => SENSOR_POINTS.map(p => {
    const src = p.sourceId ? SOURCES.find(s => s.id === p.sourceId) : null
    const mult = src ? sliders[src.type] / 100 : 1
    return { ...p, mult, plumeR: (p.spread === 'CONCENTRATED' ? 20 : p.spread === 'LINEAR' ? 15 : 25) * Math.min(3, mult * 0.7) }
  }), [sliders])

  return (
    <div className="page-fade">
      {anyExceeded && (
        <div style={{ background: '#1a0808', border: '1px solid #ff445530', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: '#ff4455', animation: 'highPulse 2s infinite' }}>
          WARNING: Predicted values exceed WHO drinking water guidelines under current scenario
        </div>
      )}

      <div className="page-header">
        <h2>What-If Simulator</h2>
        <p>Adjust upstream source intensity and see downstream impact in real time</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 260px', gap: 14, height: 'calc(100vh - 260px)' }}>
        {/* LEFT: Source Controls */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Source Controls</div>
          {SOURCES.map(s => (
            <div key={s.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.type}</span>
                <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: sliders[s.type] > 200 ? '#ff4455' : '#888' }}>{sliders[s.type]}%</span>
              </div>
              <input type="range" min={0} max={500} value={sliders[s.type]} onChange={e => setSlider(s.type, +e.target.value)}
                style={{ width: '100%', accentColor: s.color }} />
              <div style={{ fontSize: 9, color: '#333', marginTop: 2 }}>{s.waste[0]}, {s.waste[1]}</div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 }}>Presets</div>
          {PRESETS.map(p => (
            <button key={p.label} className="filter-btn" onClick={() => applyPreset(p)} style={{ width: '100%', marginBottom: 4, fontSize: 11, textAlign: 'left' }}>{p.label}</button>
          ))}
        </div>

        {/* CENTER: River Map */}
        <div style={{ background: '#060a14', borderRadius: 12, border: '1px solid #1a2332', overflow: 'hidden' }}>
          <svg viewBox="0 0 1100 400" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="wg" x1="0%" x2="100%"><stop offset="0%" stopColor="#082840" /><stop offset="100%" stopColor="#0a4060" /></linearGradient>
              <radialGradient id="wH"><stop offset="0%" stopColor="#ff4455" stopOpacity="0.5" /><stop offset="100%" stopColor="#ff4455" stopOpacity="0" /></radialGradient>
              <radialGradient id="wM"><stop offset="0%" stopColor="#ffaa00" stopOpacity="0.35" /><stop offset="100%" stopColor="#ffaa00" stopOpacity="0" /></radialGradient>
              <filter id="wgl"><feGaussianBlur stdDeviation="3" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <path d={RIVER_PATH} fill="none" stroke="#051525" strokeWidth="36" strokeLinecap="round" opacity="0.8" />
            <path d={RIVER_PATH} fill="none" stroke="url(#wg)" strokeWidth="24" strokeLinecap="round" />
            <path d={RIVER_PATH} fill="none" stroke="#20aacc" strokeWidth="2" opacity="0.3" strokeDasharray="6 18" strokeDashoffset={-tick * 2} />

            {/* Plumes */}
            {pointMults.filter(p => p.mult > 0.3 && p.severity !== 'low').map(p => (
              <ellipse key={`pl${p.id}`} cx={p.x} cy={p.y}
                rx={p.spread === 'LINEAR' ? p.plumeR * 2.5 : p.plumeR * 1.3} ry={p.plumeR}
                fill={p.mult > 2 ? 'url(#wH)' : 'url(#wM)'}
                opacity={(0.3 + p.mult * 0.2) * (0.7 + 0.3 * Math.sin(tick * 0.04 + p.id))} />
            ))}

            {/* Sources with intensity indicator */}
            {SOURCES.map(s => {
              const intensity = sliders[s.type] / 100
              const glow = intensity > 2 ? 6 : intensity > 1 ? 3 : 0
              return (
                <g key={s.id}>
                  {glow > 0 && <circle cx={s.x} cy={s.y} r={16 + glow} fill={s.color} opacity={0.1 * intensity} filter="url(#wgl)" />}
                  <rect x={s.x - 14} y={s.y - 14} width={28} height={28} rx={6} fill="#0a0e1a" stroke={s.color} strokeWidth={intensity > 2 ? 2 : 1} opacity="0.9" />
                  <text x={s.x} y={s.y + 4} textAnchor="middle" fill={s.color} fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">{s.type[0]}</text>
                  <text x={s.x} y={s.y + 24} textAnchor="middle" fill="#333" fontSize="7">{sliders[s.type]}%</text>
                </g>
              )
            })}

            {/* Sensor points */}
            {pointMults.map(p => {
              const c = p.mult > 2 ? '#ff4455' : p.mult > 1 ? '#ffaa00' : '#44cc66'
              return <circle key={`sp${p.id}`} cx={p.x} cy={p.y} r={4} fill={c} stroke="#060a14" strokeWidth="1.5" filter="url(#wgl)" />
            })}
          </svg>
        </div>

        {/* RIGHT: Predicted Impact */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Predicted Impact</div>
          {[
            { l: 'TDS', v: aTds, u: 'ppm', lim: WHO_LIMITS.tds },
            { l: 'Turbidity', v: aTurb, u: 'NTU', lim: WHO_LIMITS.turbidity },
            { l: 'Nitrate', v: aNit, u: 'ppm', lim: WHO_LIMITS.nitrate },
            { l: 'Bloom Risk', v: aBloom, u: '%', lim: WHO_LIMITS.bloom },
          ].map(p => {
            const exceeded = p.v > p.lim
            const days = daysUntil(p.v, p.lim)
            return (
              <div key={p.l} style={{ background: '#0a0e16', borderRadius: 8, padding: '10px 12px', border: exceeded ? '1px solid #ff445530' : '1px solid #151a28' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: '#444' }}>{p.l}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: exceeded ? '#ff4455' : '#ccc' }}>{p.v.toFixed(p.u === 'NTU' ? 2 : 0)} {p.u}</span>
                </div>
                {!exceeded && Number(days) > 0 && <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>Breach in ~{days} days at current rate</div>}
                {exceeded && <div style={{ fontSize: 9, color: '#ff4455', marginTop: 3 }}>EXCEEDS WHO LIMIT ({p.lim} {p.u})</div>}
              </div>
            )
          })}
          <div style={{ background: '#0a0e16', borderRadius: 8, padding: '12px', border: '1px solid #151a28', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#333', marginBottom: 4 }}>HEALTH SCORE</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', color: aHealth > 60 ? '#44cc66' : aHealth > 30 ? '#ffaa00' : '#ff4455' }}>{aHealth.toFixed(0)}</div>
          </div>
          <button className="filter-btn" onClick={() => navigator.clipboard.writeText(reportText)} style={{ marginTop: 'auto' }}>Generate Report</button>
        </div>
      </div>
    </div>
  )
}
