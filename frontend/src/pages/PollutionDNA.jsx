import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLatest, postSourceAnalysis } from '../api'

const SRC_COLORS = {
  'Industrial Discharge': '#e74c3c',
  'Sewage Contamination': '#8B4513',
  'Agricultural Runoff': '#27ae60',
  'Solid Waste Leachate': '#7f8c8d',
}

// Radar axes — the 3 real measured parameters the source engine uses
const AXES = [
  { key: 'tds', label: 'TDS', max: 1000 },
  { key: 'turbidity', label: 'Turbidity', max: 50 },
  { key: 'ph', label: 'pH', max: 14 },
]

function lerp(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t) }

export default function PollutionDNA() {
  const [live, setLive] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [selected, setSelected] = useState(null)
  const [radarValues, setRadarValues] = useState([0, 0, 0])
  const animRef = useRef(null)
  const prevRef = useRef([0, 0, 0])

  // Poll live reading
  useEffect(() => {
    const load = () => fetchLatest().then(d => setLive(d?.reading)).catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  // Run real source fingerprint when reading changes
  useEffect(() => {
    if (!live || live.tds == null) return
    postSourceAnalysis({
      tds: live.tds,
      turbidity: live.turbidity || 0,
      ph: live.ph || 7.0,
      temperature: live.temperature || 25,
    }).then(r => {
      if (r.status === 'ok') {
        setAnalysis(r)
        if (!selected) setSelected(r.source)
      }
    }).catch(() => {})
  }, [live?.tds, live?.turbidity, live?.ph])

  const profiles = analysis?.profiles || {}
  const scores = analysis?.scores || {}
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1])

  // Profile centroid → normalized radar vector [0,1]
  const profileVec = useCallback((label) => {
    const p = profiles[label]
    if (!p) return [0, 0, 0]
    return [
      Math.min(1, p.tds_center / 1000),
      Math.min(1, p.turbidity_center / 50),
      Math.min(1, p.ph_center / 14),
    ]
  }, [profiles])

  // Live reading normalized radar vector
  const liveVec = live ? [
    Math.min(1, (live.tds || 0) / 1000),
    Math.min(1, (live.turbidity || 0) / 50),
    Math.min(1, (live.ph || 7) / 14),
  ] : [0, 0, 0]

  // Animate radar morph to selected profile
  useEffect(() => {
    if (!selected || !profiles[selected]) return
    const from = prevRef.current.slice()
    const to = profileVec(selected)
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
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [selected, profiles])

  // Radar polygon helper
  const CX = 130, CY = 120, R = 85
  const polyPoints = (vec) => vec.map((v, i) => {
    const angle = (i / AXES.length) * Math.PI * 2 - Math.PI / 2
    const r = v * R
    return `${CX + r * Math.cos(angle)},${CY + r * Math.sin(angle)}`
  }).join(' ')

  const bestMatch = sortedScores[0]
  const selColor = SRC_COLORS[selected] || 'var(--accent)'

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Pollution DNA</h2>
        <p>Chemical fingerprinting — live reading matched against source profiles via z-score distance (BIS-derived source engine)</p>
      </div>

      {!analysis && (
        <div className="loading">Waiting for live sensor reading...</div>
      )}

      {analysis && (
        <>
          {/* Best match banner */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20,
            borderLeft: `4px solid ${SRC_COLORS[analysis.source] || 'var(--accent)'}`,
          }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Closest Match</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: SRC_COLORS[analysis.source] || 'var(--accent)' }}>
                {analysis.source}
                {analysis.ambiguous && <span style={{ color: '#d4a017', fontSize: 11, marginLeft: 8 }}>AMBIGUOUS</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{analysis.description}</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', color: SRC_COLORS[analysis.source] || 'var(--accent)' }}>
                {(analysis.confidence * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Confidence</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
            {/* Radar */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Signature — {selected}
              </div>
              <svg viewBox="0 0 260 230" style={{ width: '100%' }}>
                {/* Grid rings */}
                {[0.33, 0.66, 1].map((g, i) => (
                  <polygon key={i}
                    points={polyPoints([g, g, g])}
                    fill="none" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
                ))}
                {/* Axes */}
                {AXES.map((ax, i) => {
                  const angle = (i / AXES.length) * Math.PI * 2 - Math.PI / 2
                  const x = CX + R * Math.cos(angle)
                  const y = CY + R * Math.sin(angle)
                  return (
                    <g key={ax.key}>
                      <line x1={CX} y1={CY} x2={x} y2={y} stroke="var(--border)" strokeWidth="1" opacity="0.5" />
                      <text x={CX + (R + 18) * Math.cos(angle)} y={CY + (R + 18) * Math.sin(angle) + 4}
                        textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">{ax.label}</text>
                    </g>
                  )
                })}
                {/* Profile polygon (selected source) */}
                <polygon points={polyPoints(radarValues)}
                  fill={selColor} fillOpacity="0.18" stroke={selColor} strokeWidth="2" />
                {/* Live reading polygon */}
                <polygon points={polyPoints(liveVec)}
                  fill="#2090b0" fillOpacity="0.12" stroke="#2090b0" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: selColor }}>■ {selected}</span>
                <span style={{ fontSize: 10, color: '#2090b0' }}>▢ Live reading</span>
              </div>
            </div>

            {/* Scores + evidence */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Match scores */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Source Similarity (z-score → normalized)
                </div>
                {sortedScores.map(([label, score], i) => (
                  <div key={label}
                    onClick={() => setSelected(label)}
                    className="source-bar-row"
                    style={{ cursor: 'pointer', opacity: selected === label ? 1 : 0.7 }}>
                    <span className="source-bar-label">{label}</span>
                    <div className="source-bar-track">
                      <div className="source-bar-fill"
                        style={{ width: `${score * 100}%`, background: SRC_COLORS[label] || 'var(--accent)' }} />
                    </div>
                    <span className="source-bar-value">{(score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>

              {/* Live parameters */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Live Reading vs {selected} Profile
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Parameter', 'Measured', `${selected} Center`].map(h => (
                        <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['TDS', live?.tds?.toFixed(0), profiles[selected]?.tds_center, 'ppm'],
                      ['Turbidity', live?.turbidity?.toFixed(1), profiles[selected]?.turbidity_center, 'NTU'],
                      ['pH', live?.ph?.toFixed(1), profiles[selected]?.ph_center, ''],
                    ].map(([label, meas, center, unit]) => (
                      <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>{label}</td>
                        <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{meas} {unit}</td>
                        <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{center} {unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Chemical evidence */}
              {analysis.chemical_evidence?.length > 0 && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Chemical Evidence ({analysis.source})
                  </div>
                  {analysis.chemical_evidence.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, paddingLeft: 10, borderLeft: `2px solid ${SRC_COLORS[analysis.source] || 'var(--accent)'}` }}>{e}</div>
                  ))}
                  {analysis.ambiguous && analysis.ambiguity_note && (
                    <div style={{ fontSize: 10, color: '#d4a017', marginTop: 8 }}>{analysis.ambiguity_note}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Source descriptions */}
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {Object.entries(profiles).map(([label, p]) => (
              <div key={label}
                onClick={() => setSelected(label)}
                style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${selected === label ? (SRC_COLORS[label] || 'var(--accent)') : 'var(--border)'}`,
                  borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'border-color 0.2s',
                }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: SRC_COLORS[label] || 'var(--accent)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.description}</div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                  TDS {p.tds_center} · Turb {p.turbidity_center} · pH {p.ph_center}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5 }}>
            {analysis.methodology_note}
          </div>
        </>
      )}
    </div>
  )
}
