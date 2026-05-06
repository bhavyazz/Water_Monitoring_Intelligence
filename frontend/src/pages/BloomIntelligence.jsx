import { useState, useEffect, useMemo } from 'react'
import { fetchLatest, fetchHistory } from '../api'
import { TIME_SERIES } from '../data/syntheticData'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
         ScatterChart, Scatter, ZAxis, ReferenceLine, Cell } from 'recharts'

function CTip({ active, payload }) {
  if (!active || !payload?.length) return null
  return <div className="custom-tooltip">
    {payload.map((p, i) => <div key={i} style={{ color: p.color || p.stroke || '#ccc' }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</div>)}
  </div>
}

/* Animated semicircle gauge */
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
      <path d={arc(-180, 0)} fill="none" stroke="#151a28" strokeWidth="10" strokeLinecap="round" />
      {[[-180,-144,'#44cc66'],[-144,-108,'#88cc44'],[-108,-72,'#ffaa00'],[-72,-36,'#ff6644'],[-36,0,'#ff4455']].map(([s,e,cl]) =>
        <path key={s} d={arc(s,e)} fill="none" stroke={cl} strokeWidth="10" strokeLinecap="round" opacity="0.5" />
      )}
      <line x1={cx} y1={cy} x2={cx + (r - 8) * Math.cos(nr)} y2={cy + (r - 8) * Math.sin(nr)} stroke={col} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4" fill={col} />
      <text x={cx} y={cy + 22} textAnchor="middle" fill={col} fontSize="13" fontWeight="700" fontFamily="JetBrains Mono">{risk}</text>
      <text x={cx} y={cy + 35} textAnchor="middle" fill="#444" fontSize="9">{c.toFixed(0)}% confidence</text>
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

  const risk = latest?.bloom_risk || 'LOW'
  const riskColor = risk === 'HIGH' ? '#ff4455' : risk === 'MODERATE' ? '#ffaa00' : '#44cc66'
  const nitrate = latest?.nitrate ?? 15
  const temp = latest?.temperature ?? 26
  const green = latest?.rgb?.[1] ?? 100
  const riskScore = Math.min(100, (nitrate / 50) * 40 + (temp / 35) * 30 + (green / 200) * 30)
  const riskLabel = riskScore > 80 ? 'CRITICAL' : riskScore > 60 ? 'ALERT' : riskScore > 40 ? 'WARNING' : riskScore > 20 ? 'WATCH' : 'NO RISK'
  const isCritical = riskLabel === 'CRITICAL' || riskLabel === 'ALERT'

  const riskCounts = { LOW: 0, MODERATE: 0, HIGH: 0 }
  history.forEach(r => { if (r.bloom_risk) riskCounts[r.bloom_risk]++ })

  const histChart = history.map(r => ({
    time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
    nitrate: r.nitrate, temperature: r.temperature,
  }))

  const scatter = useMemo(() => TIME_SERIES.map(d => ({
    nitrate: d.nitrate, green: d.greenChannel, temp: d.temperature,
    risk: d.nitrate > 20 && d.temperature > 28 ? 'danger' : d.nitrate > 12 ? 'warn' : 'safe',
  })), [])

  const bubbleCol = r => r === 'danger' ? '#44ff88' : r === 'warn' ? '#88ddaa' : '#3388aa'

  return (
    <div className="page-fade">
      {/* Critical banner */}
      {isCritical && (
        <div style={{ background: 'linear-gradient(90deg, #ff445520, #ff445508)', border: '1px solid #ff445530', borderRadius: 8, padding: '10px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', animation: 'highPulse 1.5s infinite' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#ff4455' }}>{riskLabel}: Algal bloom conditions detected</span>
          <span style={{ fontSize: 11, color: '#ff6666', fontFamily: 'var(--font-mono)' }}>{latest?.latitude?.toFixed(4)}, {latest?.longitude?.toFixed(4)}</span>
        </div>
      )}

      <div className="page-header">
        <h2>Bloom Intelligence</h2>
        <p>Multi-parameter algal bloom risk assessment, prediction, and trend analysis</p>
      </div>

      {/* Row 1: Hero + Gauge + Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, marginBottom: 20 }}>
        {/* Hero ripple card */}
        <div className={`bloom-hero risk-${risk.toLowerCase()}`} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
          <div className="bloom-ripple" />
          <div className={`bloom-risk-label ${risk === 'HIGH' ? 'high-pulse' : ''}`} style={{ color: riskColor, fontSize: 40 }}>{risk}</div>
          <div className="bloom-risk-sub">Current Bloom Risk</div>
        </div>

        {/* Gauge */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Prediction Gauge</div>
          <Gauge score={riskScore} risk={riskLabel} />
        </div>

        {/* Quick metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Nitrate', `${nitrate.toFixed(2)} ppm`, nitrate > 25 ? '#ff4455' : '#ccc'],
            ['Temperature', `${temp.toFixed(1)} C`, temp > 30 ? '#ff4455' : '#ccc'],
            ['Green Channel', `${green}`, green > 120 ? '#44ff88' : '#ccc'],
            ['Risk Score', `${riskScore.toFixed(0)}%`, riskScore > 60 ? '#ff4455' : '#ffaa00'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 2: Reaction scatter + Nitrate vs Temp trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <h3>Reaction Graph — Nitrate vs Green Intensity</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
              <XAxis dataKey="nitrate" name="Nitrate" tick={{ fill: '#444', fontSize: 10 }} />
              <YAxis dataKey="green" name="Green" tick={{ fill: '#444', fontSize: 10 }} />
              <ZAxis dataKey="temp" range={[30, 180]} />
              <ReferenceLine y={120} stroke="#ff445560" strokeDasharray="6 4" />
              <Tooltip content={<CTip />} />
              <Scatter name="Readings" data={scatter} animationDuration={800}>
                {scatter.map((d, i) => <Cell key={i} fill={bubbleCol(d.risk)} fillOpacity={0.65} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <h3>Nitrate vs Temperature Trend</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={histChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
              <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={{ fill: '#444', fontSize: 9 }} /><YAxis yAxisId="r" orientation="right" tick={{ fill: '#444', fontSize: 9 }} />
              <Tooltip content={<CTip />} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="l" type="monotone" dataKey="nitrate" name="Nitrate" stroke="#ffaa00" strokeWidth={1.5} dot={false} animationDuration={600} />
              <Line yAxisId="r" type="monotone" dataKey="temperature" name="Temp" stroke="#44cc66" strokeWidth={1.5} dot={false} animationDuration={600} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3: 3 synced parameter charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {[
          { key: 'nitrate', label: 'Nitrate', color: '#ffaa00', th: 25 },
          { key: 'temperature', label: 'Temperature', color: '#44cc66', th: 30 },
          { key: 'greenChannel', label: 'Green Channel', color: '#00cc88', th: 120 },
        ].map(ch => (
          <div key={ch.key} className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e', padding: 14 }}>
            <h3 style={{ fontSize: 10 }}>{ch.label} Over Time</h3>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={TIME_SERIES}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
                <XAxis dataKey="time" tick={{ fill: '#333', fontSize: 8 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#333', fontSize: 8 }} />
                <ReferenceLine y={ch.th} stroke="#ff445550" strokeDasharray="4 3" />
                <Line type="monotone" dataKey={ch.key} stroke={ch.color} strokeWidth={1.5} dot={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Assessment rules */}
      <div style={{ marginTop: 16, background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Assessment Rules</div>
        <div style={{ fontSize: 11, color: '#555', lineHeight: 2.2, display: 'flex', gap: 24 }}>
          <span><span className="badge badge-high">HIGH</span> Nitrate &gt; 25 + Temp &gt; 30</span>
          <span><span className="badge badge-moderate">MODERATE</span> Nitrate &gt; 12</span>
          <span><span className="badge badge-low">LOW</span> Otherwise</span>
        </div>
      </div>
    </div>
  )
}
