import { useState, useEffect, useMemo } from 'react'
import { fetchLatest, fetchHistory } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
         ScatterChart, Scatter, ZAxis, ReferenceLine, Cell } from 'recharts'

// Real bloom engine (clustering/bloom_predictor.py) uses ONLY pH, temperature,
// turbidity — no nitrate/phosphate (unavailable from the IoT sensors).
//   HIGH:     pH>8.5 & temp>30 & turb<3   OR  pH>8.0 & temp>28 & turb<2
//   MODERATE: pH>7.8 & temp>27 & turb<5   OR  pH>8.0 & temp>25
//   LOW:      otherwise

function CTip({ active, payload }) {
  if (!active || !payload?.length) return null
  return <div className="custom-tooltip">
    {payload.map((p, i) => <div key={i} style={{ color: p.color || p.stroke || '#ccc' }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</div>)}
  </div>
}

// Bloom favorability index [0-100] from the 3 real drivers (transparent, not a black box):
//   alkalinity (pH→8.5), warmth (temp→30), clarity (low turbidity→clear water)
function favorability(ph, temp, turb) {
  const fPh = Math.max(0, Math.min(1, (ph - 7.0) / (8.5 - 7.0)))
  const fTemp = Math.max(0, Math.min(1, (temp - 25) / (30 - 25)))
  const fTurb = Math.max(0, Math.min(1, (5 - turb) / (5 - 1)))
  return Math.round((0.40 * fPh + 0.35 * fTemp + 0.25 * fTurb) * 100)
}

function Gauge({ score, risk }) {
  const c = Math.max(0, Math.min(100, score))
  const ang = -90 + (c / 100) * 180
  const col = c > 80 ? '#ff4455' : c > 60 ? '#ff6644' : c > 40 ? '#ffaa00' : c > 20 ? '#88cc44' : '#44cc66'
  const cx = 100, cy = 95, r = 75
  const arc = (s, e) => {
    const sr = (s * Math.PI) / 180, er = (e * Math.PI) / 180
    return `M ${cx + r * Math.cos(sr)},${cy + r * Math.sin(sr)} A ${r},${r} 0 0,1 ${cx + r * Math.cos(er)},${cy + r * Math.sin(er)}`
  }
  const nr = (ang * Math.PI) / 180
  return (
    <svg viewBox="0 0 200 120" style={{ width: 220 }}>
      <path d={arc(-180, 0)} fill="none" stroke="#e0e0e0" strokeWidth="10" strokeLinecap="round" />
      {[[-180,-144,'#44cc66'],[-144,-108,'#88cc44'],[-108,-72,'#ffaa00'],[-72,-36,'#ff6644'],[-36,0,'#ff4455']].map(([s,e,cl]) =>
        <path key={s} d={arc(s,e)} fill="none" stroke={cl} strokeWidth="10" strokeLinecap="round" opacity="0.5" />
      )}
      <line x1={cx} y1={cy} x2={cx + (r - 8) * Math.cos(nr)} y2={cy + (r - 8) * Math.sin(nr)} stroke={col} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4" fill={col} />
      <text x={cx} y={cy + 22} textAnchor="middle" fill={col} fontSize="13" fontWeight="700" fontFamily="JetBrains Mono">{risk}</text>
      <text x={cx} y={cy + 35} textAnchor="middle" fill="#444" fontSize="9">{c.toFixed(0)} favorability</text>
    </svg>
  )
}

export default function BloomIntelligence() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    const load = () => {
      fetchLatest().then(d => setLatest(d?.reading))
      fetchHistory(100).then(d => setHistory(d?.readings || []))
    }
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  const risk = latest?.bloom_risk || 'LOW'   // real engine output
  const riskColor = risk === 'HIGH' ? '#ff4455' : risk === 'MODERATE' ? '#ffaa00' : '#44cc66'
  const temp = latest?.temperature ?? 0
  const ph = latest?.ph ?? 7.0
  const turb = latest?.turbidity ?? 0
  const score = favorability(ph, temp, turb)
  const isCritical = risk === 'HIGH'

  const riskCounts = { LOW: 0, MODERATE: 0, HIGH: 0 }
  history.forEach(r => { if (r.bloom_risk) riskCounts[r.bloom_risk]++ })

  // Real history charts (pH, temperature, turbidity)
  const histChart = history.map(r => ({
    time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
    ph: r.ph, temperature: r.temperature, turbidity: r.turbidity,
  }))

  // Scatter: temp vs pH, sized by clarity, colored by real bloom_risk
  const scatter = useMemo(() => history.filter(r => r.temperature != null && r.ph != null).map(r => ({
    temp: r.temperature, ph: r.ph,
    clarity: Math.max(1, 30 - (r.turbidity || 5) * 4),
    risk: r.bloom_risk || 'LOW',
  })), [history])

  const bubbleCol = r => r === 'HIGH' ? '#ff4455' : r === 'MODERATE' ? '#ffaa00' : '#44cc66'

  return (
    <div className="page-fade">
      {isCritical && (
        <div style={{ background: 'linear-gradient(90deg, #ff445520, #ff445508)', border: '1px solid #ff445530', borderRadius: 8, padding: '10px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', animation: 'highPulse 1.5s infinite' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#ff4455' }}>HIGH bloom risk — warm, alkaline, clear water</span>
          <span style={{ fontSize: 11, color: '#ff6666', fontFamily: 'var(--font-mono)' }}>{latest?.latitude?.toFixed(4)}, {latest?.longitude?.toFixed(4)}</span>
        </div>
      )}

      <div className="page-header">
        <h2>Bloom Intelligence</h2>
        <p>Algal bloom risk from pH, temperature &amp; turbidity (BloomPredictor rule engine) — no nitrate sensor required</p>
      </div>

      {/* Row 1: Hero + Gauge + real drivers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, marginBottom: 20 }}>
        <div className={`bloom-hero risk-${risk.toLowerCase()}`} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
          <div className="bloom-ripple" />
          <div className={`bloom-risk-label ${risk === 'HIGH' ? 'high-pulse' : ''}`} style={{ color: riskColor, fontSize: 40 }}>{risk}</div>
          <div className="bloom-risk-sub">Current Bloom Risk</div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Favorability Index</div>
          <Gauge score={score} risk={risk} />
        </div>

        {/* Real drivers vs thresholds */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['pH', ph.toFixed(2), ph > 8.0 ? '#ff4455' : ph > 7.8 ? '#ffaa00' : '#44cc66', 'alkaline >8 favors'],
            ['Temperature', `${temp.toFixed(1)} °C`, temp > 30 ? '#ff4455' : temp > 27 ? '#ffaa00' : '#44cc66', 'warm >28 favors'],
            ['Turbidity', `${turb.toFixed(1)} NTU`, turb < 2 ? '#ff4455' : turb < 5 ? '#ffaa00' : '#44cc66', 'clear <3 favors'],
            ['Favorability', `${score}%`, score > 60 ? '#ff4455' : score > 40 ? '#ffaa00' : '#44cc66', 'pH+temp+clarity'],
          ].map(([l, v, c, sub]) => (
            <div key={l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c, marginTop: 4 }}>{v}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 2: scatter + pH/temp trend (real history) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div className="chart-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3>Bloom Window — Temperature vs pH (size = clarity)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="temp" name="Temp °C" tick={{ fill: '#444', fontSize: 10 }} domain={['auto', 'auto']} />
              <YAxis dataKey="ph" name="pH" tick={{ fill: '#444', fontSize: 10 }} domain={['auto', 'auto']} />
              <ZAxis dataKey="clarity" range={[30, 200]} />
              <ReferenceLine x={28} stroke="#ff445560" strokeDasharray="6 4" />
              <ReferenceLine y={8.0} stroke="#ff445560" strokeDasharray="6 4" />
              <Tooltip content={<CTip />} />
              <Scatter name="Readings" data={scatter} animationDuration={800}>
                {scatter.map((d, i) => <Cell key={i} fill={bubbleCol(d.risk)} fillOpacity={0.6} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>Upper-right quadrant (warm + alkaline) = bloom-favorable. Bigger dot = clearer water.</div>
        </div>
        <div className="chart-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3>pH &amp; Temperature Trend</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={histChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={{ fill: '#444', fontSize: 9 }} domain={['auto', 'auto']} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: '#444', fontSize: 9 }} domain={['auto', 'auto']} />
              <Tooltip content={<CTip />} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="l" type="monotone" dataKey="ph" name="pH" stroke="#6c5ce7" strokeWidth={1.5} dot={false} animationDuration={600} />
              <Line yAxisId="r" type="monotone" dataKey="temperature" name="Temp °C" stroke="#44cc66" strokeWidth={1.5} dot={false} animationDuration={600} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3: 3 real driver charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {[
          { key: 'ph', label: 'pH', color: '#6c5ce7', th: 8.0 },
          { key: 'temperature', label: 'Temperature °C', color: '#44cc66', th: 28 },
          { key: 'turbidity', label: 'Turbidity NTU', color: '#888', th: 3 },
        ].map(ch => (
          <div key={ch.key} className="chart-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 14 }}>
            <h3 style={{ fontSize: 10 }}>{ch.label} Over Time</h3>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={histChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="time" tick={{ fill: '#333', fontSize: 8 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#333', fontSize: 8 }} domain={['auto', 'auto']} />
                <ReferenceLine y={ch.th} stroke="#ff445550" strokeDasharray="4 3" />
                <Line type="monotone" dataKey={ch.key} stroke={ch.color} strokeWidth={1.5} dot={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* History distribution + real rules */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Last {history.length} readings</div>
          {['HIGH', 'MODERATE', 'LOW'].map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 70, fontSize: 11, color: k === 'HIGH' ? '#ff4455' : k === 'MODERATE' ? '#ffaa00' : '#44cc66' }}>{k}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${history.length ? (riskCounts[k] / history.length) * 100 : 0}%`, background: k === 'HIGH' ? '#ff4455' : k === 'MODERATE' ? '#ffaa00' : '#44cc66' }} />
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>{riskCounts[k]}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Assessment Rules (BloomPredictor engine)</div>
          <div style={{ fontSize: 11, color: '#555', lineHeight: 2 }}>
            <div><span className="badge badge-high">HIGH</span> pH &gt; 8.5 &amp; temp &gt; 30 &amp; turbidity &lt; 3 &nbsp;<em>or</em>&nbsp; pH &gt; 8.0 &amp; temp &gt; 28 &amp; turbidity &lt; 2</div>
            <div><span className="badge badge-moderate">MODERATE</span> pH &gt; 7.8 &amp; temp &gt; 27 &amp; turbidity &lt; 5 &nbsp;<em>or</em>&nbsp; pH &gt; 8.0 &amp; temp &gt; 25</div>
            <div><span className="badge badge-low">LOW</span> otherwise</div>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            Algae thrive in warm, alkaline, clear water. High turbidity blocks photosynthesis and lowers risk. Nitrate/phosphate are not measured by the sensor array, so this is a risk indicator, not a predictive model.
          </div>
        </div>
      </div>
    </div>
  )
}
