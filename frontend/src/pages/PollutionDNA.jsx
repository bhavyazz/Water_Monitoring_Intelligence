import React, { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLatest } from '../api'

const PARAMS = ['Nitrate', 'TDS', 'Turbidity', 'Phosphate', 'Heavy Metals']
const SOURCES = ['Factory', 'Farm', 'Sewage', 'Landfill']
const SRC_COLORS = { Factory: '#ff4455', Farm: '#44cc66', Sewage: '#ffaa00', Landfill: '#bb66ff' }

/* Fingerprint vectors (0-100 scale) */
const FINGERPRINTS = {
  Factory:  [40, 85, 70, 20, 95],
  Farm:     [95, 45, 50, 80, 15],
  Sewage:   [60, 70, 80, 55, 25],
  Landfill: [30, 55, 40, 35, 80],
}

const DESCRIPTIONS = {
  Factory: 'Industrial plants discharge heavy metals (lead, mercury, chromium) from manufacturing processes. Thermal pollution raises water temperature. Solvents and acids lower pH and increase TDS significantly.',
  Farm: 'Farms apply nitrogen-based fertilisers — nitrate leaches into groundwater and flows into rivers during rain events. Phosphate from animal manure causes eutrophication. Pesticide residues add organic pollutants.',
  Sewage: 'Sewage treatment plants release partially treated wastewater containing ammonia, pathogens, and suspended solids. High BOD depletes dissolved oxygen. Turbidity is elevated from organic particulates.',
  Landfill: 'Landfill leachate contains dissolved heavy metals from batteries and electronics, plus microplastics. Methane production indicates anaerobic decomposition. TDS is moderately elevated from mineral dissolution.',
}

/* Cosine similarity */
function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i] }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0
}

/* Interpolate between two arrays */
function lerp(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t) }

export default function PollutionDNA() {
  const [selected, setSelected] = useState('Factory')
  const [radarValues, setRadarValues] = useState(FINGERPRINTS.Factory)
  const animRef = useRef(null)
  const prevRef = useRef(FINGERPRINTS.Factory)
  const [live, setLive] = useState(null)

  useEffect(() => {
    const load = () => fetchLatest().then(d => setLive(d?.reading)).catch(() => {})
    load(); const id = setInterval(load, 3000); return () => clearInterval(id)
  }, [])

  /* Animate radar morph */
  const morphTo = useCallback((src) => {
    setSelected(src)
    const from = prevRef.current.slice()
    const to = FINGERPRINTS[src]
    const t0 = Date.now()
    const dur = 600
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setRadarValues(lerp(from, to, e))
      if (p < 1) animRef.current = requestAnimationFrame(step)
      else prevRef.current = to
    }
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = requestAnimationFrame(step)
  }, [])

  /* Build sensor vector from live data for matching */
  const sensorVec = live ? [
    Math.min(100, (live.nitrate || 0) * 3),
    Math.min(100, (live.tds || 0) / 10),
    Math.min(100, (live.turbidity || 0) * 20),
    Math.min(100, (live.nitrate || 0) * 1.5), // phosphate proxy
    Math.min(100, (live.tds || 0) / 12),       // heavy metal proxy
  ] : [50, 50, 50, 50, 50]

  const matches = SOURCES.map(s => ({ name: s, score: cosineSim(sensorVec, FINGERPRINTS[s]) })).sort((a, b) => b.score - a.score)
  const bestMatch = matches[0]

  /* Radar polygon points */
  const radarPoly = radarValues.map((v, i) => {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2
    const r = (v / 100) * 85
    return `${120 + r * Math.cos(angle)},${105 + r * Math.sin(angle)}`
  }).join(' ')

  /* Heatmap color: dark → cyan */
  const heatColor = (v) => {
    const t = v / 100
    const r = Math.round(10 + t * 0), g = Math.round(15 + t * 200), b = Math.round(25 + t * 240)
    return `rgb(${r},${g},${b})`
  }

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Pollution DNA</h2>
        <p>Chemical fingerprinting — every source leaves a unique signature</p>
      </div>

      {/* Heatmap */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Spectrogram — Click a source column</div>
        <div style={{ display: 'grid', gridTemplateColumns: '100px repeat(4, 1fr)', gap: 3 }}>
          {/* Header row */}
          <div />
          {SOURCES.map(s => (
            <div key={s} onClick={() => morphTo(s)}
              style={{ textAlign: 'center', fontSize: 11, fontWeight: selected === s ? 700 : 400, color: selected === s ? SRC_COLORS[s] : '#555', cursor: 'pointer', padding: '6px 0', borderBottom: selected === s ? `2px solid ${SRC_COLORS[s]}` : '2px solid transparent', transition: 'all 0.3s' }}>
              {s}
            </div>
          ))}
          {/* Data rows */}
          {PARAMS.map((p, pi) => (
            <React.Fragment key={p}>
              <div style={{ fontSize: 10, color: '#555', display: 'flex', alignItems: 'center', paddingRight: 8 }}>{p}</div>
              {SOURCES.map(s => {
                const v = FINGERPRINTS[s][pi]
                return (
                  <div key={`${s}-${p}`} onClick={() => morphTo(s)}
                    style={{ background: heatColor(v), height: 36, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.4s', border: selected === s ? `1px solid ${SRC_COLORS[s]}40` : '1px solid transparent' }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: v > 50 ? '#fff' : '#556', fontWeight: 500 }}>{v}</span>
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Morphing Radar Chart */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: SRC_COLORS[selected], marginBottom: 4 }}>{selected} Fingerprint</div>
          <div style={{ fontSize: 11, color: '#555', lineHeight: 1.6, marginBottom: 16 }}>{DESCRIPTIONS[selected]}</div>
          <svg viewBox="0 0 240 220" style={{ width: '100%', maxWidth: 320, display: 'block', margin: '0 auto' }}>
            {/* Grid rings */}
            {[20, 40, 60, 80].map(r => (
              <circle key={r} cx="120" cy="105" r={r * 0.85} fill="none" stroke="#1a2332" strokeWidth="0.5" />
            ))}
            {/* Axis lines + labels */}
            {PARAMS.map((p, i) => {
              const angle = (i / 5) * Math.PI * 2 - Math.PI / 2
              const lx = 120 + 95 * Math.cos(angle), ly = 105 + 95 * Math.sin(angle)
              return (
                <g key={p}>
                  <line x1="120" y1="105" x2={120 + 85 * Math.cos(angle)} y2={105 + 85 * Math.sin(angle)} stroke="#1a2332" strokeWidth="0.5" />
                  <text x={lx} y={ly + 3} textAnchor="middle" fill="#444" fontSize="8" fontFamily="Inter">{p}</text>
                </g>
              )
            })}
            {/* Filled polygon */}
            <polygon points={radarPoly} fill={SRC_COLORS[selected]} fillOpacity="0.15" stroke={SRC_COLORS[selected]} strokeWidth="1.5" />
            {/* Value dots */}
            {radarValues.map((v, i) => {
              const angle = (i / 5) * Math.PI * 2 - Math.PI / 2
              const r = (v / 100) * 85
              return <circle key={i} cx={120 + r * Math.cos(angle)} cy={105 + r * Math.sin(angle)} r="3" fill={SRC_COLORS[selected]} />
            })}
          </svg>
        </div>

        {/* Match Score Panel */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Source Match — Live Sensor vs Fingerprints</div>
          {matches.map((m, i) => {
            const pct = (m.score * 100).toFixed(1)
            const isBest = i === 0
            const col = SRC_COLORS[m.name]
            return (
              <div key={m.name} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: isBest ? 700 : 400, color: isBest ? col : '#888' }}>{m.name}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: isBest ? col : '#555' }}>
                    {pct}%{isBest && <span style={{ marginLeft: 8, fontSize: 9, background: col + '20', color: col, padding: '2px 6px', borderRadius: 3 }}>BEST MATCH</span>}
                  </span>
                </div>
                <div style={{ height: 8, background: '#151a28', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: isBest ? col : '#333', width: `${pct}%`, transition: 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)', boxShadow: isBest ? `0 0 8px ${col}40` : 'none' }} />
                </div>
              </div>
            )
          })}
          <div style={{ marginTop: 20, padding: 12, background: '#0a0e16', borderRadius: 8, border: `1px solid ${SRC_COLORS[bestMatch.name]}20` }}>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 4 }}>LIVE SENSOR VECTOR</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PARAMS.map((p, i) => (
                <span key={p} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#666', background: '#151a28', padding: '2px 6px', borderRadius: 3 }}>{p}: {sensorVec[i].toFixed(0)}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
