import { useState, useEffect, useCallback } from 'react'
import { fetchHistory } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const TIME_FILTERS = [
  { label: 'Last 20', value: 20 },
  { label: 'Last 50', value: 50 },
  { label: 'Last 100', value: 100 },
  { label: 'Last 200', value: 200 },
  { label: 'Last 500', value: 500 },
]

const CHART_LINES = [
  { key: 'tds', label: 'TDS', color: '#2090b0' },
  { key: 'turbidity', label: 'Turbidity', color: '#888888' },
  { key: 'ph', label: 'pH', color: '#6c5ce7' },
  { key: 'temperature', label: 'Temperature', color: '#44cc66' },
]

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

export default function History() {
  const [readings, setReadings] = useState([])
  const [count, setCount] = useState(50)
  const [activeChart, setActiveChart] = useState('all')

  const load = useCallback(() => {
    fetchHistory(count).then(d => setReadings(d?.readings || []))
  }, [count])

  useEffect(() => { load() }, [load])

  /* Prepare chart data with timestamps as labels */
  const chartData = readings.map(r => ({
    time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
    tds: r.tds,
    turbidity: r.turbidity,
    ph: r.ph,
    temperature: r.temperature,
  }))

  const visibleLines = activeChart === 'all'
    ? CHART_LINES
    : CHART_LINES.filter(l => l.key === activeChart)

  const qualityClass = (label) => label ? `badge badge-${label.toLowerCase()}` : ''

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>History</h2>
        <p>Historical sensor readings with trend analysis</p>
      </div>

      {/* Time filter bar */}
      <div className="filter-bar">
        {TIME_FILTERS.map(f => (
          <button key={f.value} className={`filter-btn${count === f.value ? ' active' : ''}`}
            onClick={() => setCount(f.value)}>{f.label}</button>
        ))}
        <button className="filter-btn" onClick={load} style={{ marginLeft: 'auto' }}>Refresh</button>
        <span style={{ fontSize: 11, color: '#555' }}>{readings.length} readings</span>
      </div>

      {/* Chart filter */}
      <div className="filter-bar">
        <button className={`filter-btn${activeChart === 'all' ? ' active' : ''}`}
          onClick={() => setActiveChart('all')}>All Metrics</button>
        {CHART_LINES.map(l => (
          <button key={l.key} className={`filter-btn${activeChart === l.key ? ' active' : ''}`}
            onClick={() => setActiveChart(l.key)}>
            <span style={{ color: l.color, marginRight: 4 }}>&#9679;</span>{l.label}
          </button>
        ))}
      </div>

      {/* Charts */}
      {chartData.length > 0 && (
        <div className="chart-section">
          <div className="chart-card" key={activeChart}>
            <h3>Sensor Trends</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#444', fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                {visibleLines.map(l => (
                  <Line key={l.key} type="monotone" dataKey={l.key} name={l.label}
                    stroke={l.color} strokeWidth={1.5} dot={false} animationDuration={600} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Data table */}
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 400 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th><th>Temp</th><th>TDS</th><th>Turb</th>
              <th>Level</th><th>pH</th><th>Quality</th><th>Bloom</th>
            </tr>
          </thead>
          <tbody>
            {readings.slice().reverse().map((r, i) => (
              <tr key={i}>
                <td>{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '--'}</td>
                <td>{r.temperature?.toFixed(1)}</td>
                <td>{r.tds?.toFixed(0)}</td>
                <td>{r.turbidity?.toFixed(2)}</td>
                <td>{r.level?.toFixed(0)}</td>
                <td>{r.ph?.toFixed(2)}</td>
                <td><span className={qualityClass(r.quality_label)}>{r.quality_label}</span></td>
                <td><span className={qualityClass(r.bloom_risk)}>{r.bloom_risk}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {readings.length === 0 && <div className="empty-state">No readings available yet</div>}
      </div>
    </div>
  )
}
