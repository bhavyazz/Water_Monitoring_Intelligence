import { useState, useEffect, useRef } from 'react'
import { fetchLatest, fetchAlerts, fetchClusters, fetchHistory } from '../api'
import { LineChart, Line, ResponsiveContainer } from 'recharts'

/* Animated counter hook */
function useAnimatedValue(target, duration = 800) {
  const [val, setVal] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const start = prev.current, diff = target - start
    if (Math.abs(diff) < 0.01) return
    const t0 = Date.now()
    const step = () => {
      const elapsed = Date.now() - t0, progress = Math.min(1, elapsed / duration)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      setVal(start + diff * eased)
      if (progress < 1) requestAnimationFrame(step)
      else prev.current = target
    }
    requestAnimationFrame(step)
  }, [target, duration])
  return val
}

/* Mini sparkline component */
function Sparkline({ data, dataKey, color, height = 40 }) {
  if (!data || data.length < 2) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/* Circular progress ring */
function Ring({ value, max, color, size = 56 }) {
  const r = (size - 8) / 2, circ = 2 * Math.PI * r
  const pct = Math.min(1, value / max)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#151a28" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.8s ease' }} />
    </svg>
  )
}

/* Live pipeline dot animation */
function PipelineViz() {
  const [tick, setTick] = useState(0)
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 80); return () => clearInterval(id) }, [])

  const stages = ['Sensors', 'Parser', 'Preprocess', 'ML Models', 'Clustering', 'API']
  const stageColors = ['#2090b0', '#3090a0', '#44cc66', '#ffaa00', '#ff6644', '#bb66ff']
  const dotPos = (tick % 60) / 60

  return (
    <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 }}>Data Pipeline — Live</div>
      <svg viewBox="0 0 700 50" style={{ width: '100%', height: 50 }}>
        {/* Pipeline line */}
        <line x1="30" y1="25" x2="670" y2="25" stroke="#151a28" strokeWidth="2" />

        {/* Animated data dots flowing through pipeline */}
        {[0, 0.15, 0.35, 0.55, 0.75].map((offset, i) => {
          const pos = ((dotPos + offset) % 1)
          return <circle key={`dot-${i}`} cx={30 + pos * 640} cy={25} r={2.5}
            fill="#2090b0" opacity={0.3 + 0.4 * Math.sin(pos * Math.PI)}>
          </circle>
        })}

        {/* Stage nodes */}
        {stages.map((s, i) => {
          const x = 30 + (i / (stages.length - 1)) * 640
          const isActive = Math.abs(dotPos - i / (stages.length - 1)) < 0.1
          return (
            <g key={s}>
              <circle cx={x} cy={25} r={isActive ? 8 : 6} fill={isActive ? stageColors[i] : '#0d1117'}
                stroke={stageColors[i]} strokeWidth={isActive ? 2 : 1.5}
                style={{ transition: 'all 0.2s ease' }} />
              <text x={x} y={46} textAnchor="middle" fill="#444" fontSize="8" fontFamily="Inter">{s}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function Dashboard() {
  const [latest, setLatest] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [clusters, setClusters] = useState(null)
  const [history, setHistory] = useState([])
  const [uptime, setUptime] = useState(0)

  useEffect(() => {
    const load = () => {
      fetchLatest().then(setLatest).catch(() => {})
      fetchAlerts().then(setAlerts).catch(() => {})
      fetchClusters().then(setClusters).catch(() => {})
      fetchHistory(30).then(d => setHistory(d?.readings || [])).catch(() => {})
    }
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { const id = setInterval(() => setUptime(u => u + 1), 1000); return () => clearInterval(id) }, [])

  const r = latest?.reading || {}
  const tds = useAnimatedValue(r.tds || 0)
  const turb = useAnimatedValue(r.turbidity || 0)
  const nitrate = useAnimatedValue(r.nitrate || 0)
  const temp = useAnimatedValue(r.temperature || 0)
  const level = useAnimatedValue(r.level || 0)

  const healthScore = Math.round(Math.max(0, Math.min(100, 100 - tds / 10 - turb * 10 - nitrate * 1.5)))
  const healthColor = healthScore > 70 ? '#44cc66' : healthScore > 40 ? '#ffaa00' : '#ff4455'

  const sparkData = history.map(h => ({ tds: h.tds, turb: h.turbidity, nit: h.nitrate, temp: h.temperature }))

  const formatUptime = () => {
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = uptime % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="page-fade">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Dashboard</h2>
            <p>System overview and real-time water quality metrics</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#333' }}>{formatUptime()}</div>
            <div style={{ fontSize: 10, color: '#222' }}>Session uptime</div>
          </div>
        </div>
      </div>

      {/* Pipeline visualization */}
      <PipelineViz />

      {/* Health Score + Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, marginBottom: 20 }}>
        {/* Health ring */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Ring value={healthScore} max={100} color={healthColor} size={90} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: healthColor }}>{healthScore}</span>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Water Health</div>
        </div>

        {/* Metric cards with sparklines */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'TDS', value: tds, unit: 'ppm', fmt: 0, key: 'tds', color: '#f0f0f0', max: 1000 },
            { label: 'Turbidity', value: turb, unit: 'NTU', fmt: 2, key: 'turb', color: '#888', max: 5 },
            { label: 'Nitrate', value: nitrate, unit: 'ppm', fmt: 2, key: 'nit', color: '#ffaa00', max: 50 },
            { label: 'Temperature', value: temp, unit: 'C', fmt: 1, key: 'temp', color: '#44cc66', max: 35 },
          ].map(m => (
            <div key={m.label} style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color, margin: '4px 0' }}>
                {m.value.toFixed(m.fmt)}<span style={{ fontSize: 11, fontWeight: 400, color: '#444', marginLeft: 3 }}>{m.unit}</span>
              </div>
              <div style={{ marginTop: 'auto', opacity: 0.6 }}>
                <Sparkline data={sparkData} dataKey={m.key} color={m.color} height={30} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom row: Level + Quality + Bloom + Alerts + Clusters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Water Level</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#2090b0', marginTop: 6 }}>
            {level.toFixed(0)}<span style={{ fontSize: 11, fontWeight: 400, color: '#444', marginLeft: 3 }}>mm</span>
          </div>
          <div style={{ height: 3, background: '#151a28', borderRadius: 2, marginTop: 10 }}>
            <div style={{ height: '100%', borderRadius: 2, background: '#2090b0', width: `${Math.min(100, level / 5)}%`, transition: 'width 0.6s ease' }} />
          </div>
        </div>

        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Quality</div>
          <div style={{ marginTop: 8 }}>
            <span className={`badge badge-${r.quality_label?.toLowerCase()}`} style={{ fontSize: 13, padding: '5px 12px' }}>{r.quality_label || '--'}</span>
          </div>
        </div>

        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Bloom Risk</div>
          <div style={{ marginTop: 8 }}>
            <span className={`badge badge-${r.bloom_risk?.toLowerCase()}`} style={{ fontSize: 13, padding: '5px 12px' }}>{r.bloom_risk || '--'}</span>
          </div>
        </div>

        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Active Alerts</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: (alerts?.alert_count || 0) > 0 ? '#ff4455' : '#333', marginTop: 6 }}>
            {alerts?.alert_count ?? 0}
          </div>
        </div>

        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5 }}>Clusters</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#bb66ff', marginTop: 6 }}>
            {clusters?.clusters?.length ?? 0}
          </div>
        </div>
      </div>
    </div>
  )
}
