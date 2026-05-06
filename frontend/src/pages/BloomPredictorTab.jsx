import { useState, useEffect, useMemo } from 'react'
import { TIME_SERIES } from '../data/syntheticData'
import { fetchLatest } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
         ScatterChart, Scatter, ZAxis, ReferenceLine, Cell } from 'recharts'

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="custom-tooltip">
      {d?.time && <div className="tooltip-label">{d.time}</div>}
      {payload.map((p, i) => <div key={i} style={{ color: p.color || '#ccc' }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</div>)}
    </div>
  )
}

/* Semicircle gauge component */
function RiskGauge({ score, risk }) {
  const clamp = Math.max(0, Math.min(100, score))
  const angle = -90 + (clamp / 100) * 180
  const gaugeColor = clamp > 80 ? '#ff4455' : clamp > 60 ? '#ff6644' : clamp > 40 ? '#ffaa00' : clamp > 20 ? '#88cc44' : '#44cc66'
  const r = 80, cx = 100, cy = 95
  /* Arc path for background */
  const arcPath = (start, end) => {
    const s = (start * Math.PI) / 180, e = (end * Math.PI) / 180
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s)
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e)
    return `M ${x1},${y1} A ${r},${r} 0 0,1 ${x2},${y2}`
  }
  const needleRad = (angle * Math.PI) / 180
  const nx = cx + (r - 10) * Math.cos(needleRad), ny = cy + (r - 10) * Math.sin(needleRad)

  return (
    <svg viewBox="0 0 200 120" style={{ width: 240 }}>
      {/* Background arc */}
      <path d={arcPath(-180, 0)} fill="none" stroke="#1a1a2e" strokeWidth="12" strokeLinecap="round" />
      {/* Colored segments */}
      <path d={arcPath(-180, -144)} fill="none" stroke="#44cc66" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      <path d={arcPath(-144, -108)} fill="none" stroke="#88cc44" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      <path d={arcPath(-108, -72)} fill="none" stroke="#ffaa00" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      <path d={arcPath(-72, -36)} fill="none" stroke="#ff6644" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      <path d={arcPath(-36, 0)} fill="none" stroke="#ff4455" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={gaugeColor} strokeWidth="2.5" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from={`${angle - 20} ${cx} ${cy}`} to={`${angle} ${cx} ${cy}`} dur="0.8s" fill="freeze" />
      </line>
      <circle cx={cx} cy={cy} r="5" fill={gaugeColor} />
      {/* Label */}
      <text x={cx} y={cy + 25} textAnchor="middle" fill={gaugeColor} fontSize="14" fontWeight="700" fontFamily="JetBrains Mono">{risk}</text>
      <text x={cx} y={cy + 38} textAnchor="middle" fill="#555" fontSize="9" fontFamily="Inter">{clamp.toFixed(0)}% confidence</text>
    </svg>
  )
}

export default function BloomPredictorTab() {
  const [latest, setLatest] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const load = () => fetchLatest().then(d => setLatest(d?.reading))
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  /* Compute risk score from latest values */
  const nitrate = latest?.nitrate ?? 15
  const temp = latest?.temperature ?? 26
  const green = latest?.rgb?.[1] ?? 100
  const riskScore = Math.min(100, (nitrate / 50) * 40 + (temp / 35) * 30 + (green / 200) * 30)
  const riskLabel = riskScore > 80 ? 'CRITICAL' : riskScore > 60 ? 'ALERT' : riskScore > 40 ? 'WARNING' : riskScore > 20 ? 'WATCH' : 'NO RISK'
  const isCritical = riskLabel === 'CRITICAL' || riskLabel === 'ALERT'

  /* Scatter data: nitrate vs green with temp as bubble size */
  const scatterData = useMemo(() => TIME_SERIES.map(d => ({
    nitrate: d.nitrate,
    green: d.greenChannel,
    temp: d.temperature,
    risk: d.nitrate > 20 && d.temperature > 28 ? 'danger' : d.nitrate > 12 ? 'warn' : 'safe',
  })), [])

  const bubbleColor = (risk) => risk === 'danger' ? '#44ff88' : risk === 'warn' ? '#88ddaa' : '#3388aa'

  return (
    <div className="page-fade">
      {/* Critical flashing banner */}
      {isCritical && (
        <div style={{
          background: 'linear-gradient(90deg, #ff445530, #ff445510)', border: '1px solid #ff445540',
          borderRadius: 8, padding: '10px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', animation: 'highPulse 1.5s ease infinite',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#ff4455' }}>
            {riskLabel}: Algal bloom conditions detected
          </span>
          <span style={{ fontSize: 11, color: '#ff6666', fontFamily: 'var(--font-mono)' }}>
            {latest?.latitude?.toFixed(4)}, {latest?.longitude?.toFixed(4)}
          </span>
        </div>
      )}

      <div className="page-header">
        <h2>Bloom Predictor</h2>
        <p>Multi-parameter bloom risk analysis with reaction dynamics</p>
      </div>

      {/* Top panel: Reaction scatter chart */}
      <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e', marginBottom: 16 }}>
        <h3>Reaction Graph — Nitrate vs Green Channel Intensity</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
            <XAxis dataKey="nitrate" name="Nitrate (ppm)" tick={{ fill: '#444', fontSize: 10 }} label={{ value: 'Nitrate (ppm)', position: 'bottom', fill: '#444', fontSize: 10 }} />
            <YAxis dataKey="green" name="Green Channel" tick={{ fill: '#444', fontSize: 10 }} />
            <ZAxis dataKey="temp" range={[30, 200]} name="Temperature" />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={120} stroke="#ff445580" strokeDasharray="6 4" label={{ value: 'Bloom threshold', fill: '#ff4455', fontSize: 9 }} />
            <Scatter name="Readings" data={scatterData} animationDuration={1000}>
              {scatterData.map((d, i) => <Cell key={i} fill={bubbleColor(d.risk)} fillOpacity={0.7} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Middle: 3 synced line charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[
          { key: 'nitrate', label: 'Nitrate Over Time', color: '#ffaa00', threshold: 25, unit: 'ppm' },
          { key: 'temperature', label: 'Temperature Over Time', color: '#44cc66', threshold: 30, unit: '°C' },
          { key: 'greenChannel', label: 'Green Channel Over Time', color: '#00cc88', threshold: 120, unit: '' },
        ].map(ch => (
          <div key={ch.key} className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e', padding: 14 }}>
            <h3 style={{ fontSize: 10 }}>{ch.label}</h3>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={TIME_SERIES}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
                <XAxis dataKey="time" tick={{ fill: '#333', fontSize: 8 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#333', fontSize: 8 }} />
                <ReferenceLine y={ch.threshold} stroke="#ff445560" strokeDasharray="4 3" />
                <Line type="monotone" dataKey={ch.key} stroke={ch.color} strokeWidth={1.5} dot={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Bottom: Gauge + info */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24 }}>
          <h3>Bloom Risk Gauge</h3>
          <RiskGauge score={riskScore} risk={riskLabel} />
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Current Nitrate', `${nitrate.toFixed(2)} ppm`, nitrate > 25 ? '#ff4455' : '#ccc'],
            ['Current Temperature', `${temp.toFixed(1)} °C`, temp > 30 ? '#ff4455' : '#ccc'],
            ['Green Intensity', `${green}`, green > 120 ? '#44ff88' : '#ccc'],
            ['Combined Score', `${riskScore.toFixed(1)}%`, riskScore > 60 ? '#ff4455' : '#ffaa00'],
          ].map(([label, val, color]) => (
            <div key={label} className="spread-info-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
              <div className="label">{label}</div>
              <div className="value" style={{ color }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
