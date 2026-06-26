import { useState, useEffect } from 'react'
import { fetchLatest, fetchHistory } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.stroke }}>{p.name}: {p.value?.toFixed(2)}</div>
      ))}
    </div>
  )
}

export default function AlgalBloom() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    const load = () => {
      fetchLatest().then(d => setLatest(d?.reading))
      fetchHistory(100).then(d => setHistory(d?.readings || []))
    }
    load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [])

  const risk = latest?.bloom_risk || 'LOW'
  const riskColor = risk === 'HIGH' ? '#ff4444' : risk === 'MODERATE' ? '#ffaa00' : '#44cc66'

  const chartData = history.map(r => ({
    time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
    nitrate: r.nitrate,
    temperature: r.temperature,
  }))

  /* Count risk distribution in recent readings */
  const riskCounts = { LOW: 0, MODERATE: 0, HIGH: 0 }
  history.forEach(r => { if (r.bloom_risk) riskCounts[r.bloom_risk]++ })

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Algal Bloom Monitor</h2>
        <p>Real-time bloom risk assessment based on nitrate and temperature</p>
      </div>

      {/* Hero risk card with ripple animation */}
      <div className={`bloom-hero risk-${risk.toLowerCase()}`}>
        <div className="bloom-ripple" />
        <div className={`bloom-risk-label ${risk === 'HIGH' ? 'high-pulse' : ''}`} style={{ color: riskColor }}>
          {risk}
        </div>
        <div className="bloom-risk-sub">Current Algal Bloom Risk Level</div>
      </div>

      {/* Key metrics */}
      <div className="bloom-metrics">
        <div className="card">
          <div className="card-title">Nitrate Level</div>
          <div className="card-value animated-value">
            {latest?.nitrate?.toFixed(2) ?? '--'}<span className="card-unit">ppm</span>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Temperature</div>
          <div className="card-value animated-value">
            {latest?.temperature?.toFixed(1) ?? '--'}<span className="card-unit">C</span>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Water Quality</div>
          <div style={{ marginTop: 8 }}>
            <span className={`badge badge-${latest?.quality_label?.toLowerCase()}`}>{latest?.quality_label || '--'}</span>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Risk Distribution (Recent)</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ color: '#44cc66', fontFamily: 'var(--font-mono)', fontSize: 14 }}>L:{riskCounts.LOW}</span>
            <span style={{ color: '#ffaa00', fontFamily: 'var(--font-mono)', fontSize: 14 }}>M:{riskCounts.MODERATE}</span>
            <span style={{ color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 14 }}>H:{riskCounts.HIGH}</span>
          </div>
        </div>
      </div>

      {/* Nitrate vs Temperature trend chart */}
      {chartData.length > 0 && (
        <div className="chart-section">
          <div className="chart-card">
            <h3>Nitrate vs Temperature Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fill: '#444', fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#444', fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                <Line yAxisId="left" type="monotone" dataKey="nitrate" name="Nitrate (ppm)"
                  stroke="#ffaa00" strokeWidth={1.5} dot={false} animationDuration={600} />
                <Line yAxisId="right" type="monotone" dataKey="temperature" name="Temperature (C)"
                  stroke="#44cc66" strokeWidth={1.5} dot={false} animationDuration={600} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bloom rules explanation */}
      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-title">Assessment Rules</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2 }}>
          <div><span className="badge badge-high">HIGH</span> Nitrate &gt; 25 ppm AND Temperature &gt; 30 C</div>
          <div><span className="badge badge-moderate">MODERATE</span> Nitrate &gt; 12 ppm</div>
          <div><span className="badge badge-low">LOW</span> All other conditions</div>
        </div>
      </div>
    </div>
  )
}
