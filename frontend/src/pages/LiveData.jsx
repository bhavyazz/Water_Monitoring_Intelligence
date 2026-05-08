import { useState, useEffect, useRef } from 'react'
import { fetchLatest } from '../api'

/* Animated value hook */
function useAnim(target, ms = 600) {
  const [v, setV] = useState(0)
  const p = useRef(0)
  useEffect(() => {
    const s = p.current, d = target - s
    if (Math.abs(d) < 0.001) return
    const t0 = Date.now()
    const step = () => {
      const pr = Math.min(1, (Date.now() - t0) / ms)
      const e = 1 - Math.pow(1 - pr, 3)
      setV(s + d * e)
      if (pr < 1) requestAnimationFrame(step); else p.current = target
    }
    requestAnimationFrame(step)
  }, [target, ms])
  return v
}

/* Arc gauge component */
function ArcGauge({ value, max, label, unit, color, danger }) {
  const pct = Math.min(1, Math.max(0, value / max))
  const r = 42, cx = 50, cy = 50
  const arc = pct * Math.PI // semicircle = PI radians
  const x2 = cx + r * Math.cos(Math.PI - arc), y2 = cy - r * Math.sin(Math.PI - arc)
  const large = pct > 0.5 ? 1 : 0

  const gaugeColor = danger ? '#ff4455' : color

  return (
    <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 12, padding: '20px 16px', textAlign: 'center', transition: 'border-color 0.3s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = gaugeColor + '40'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#1a1a2e'}>
      <svg viewBox="0 0 100 60" style={{ width: '100%', maxWidth: 160 }}>
        {/* Background arc */}
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none" stroke="#151a28" strokeWidth="5" strokeLinecap="round" />
        {/* Value arc */}
        {pct > 0 && (
          <path d={`M ${cx - r},${cy} A ${r},${r} 0 ${large},1 ${x2},${y2}`}
            fill="none" stroke={gaugeColor} strokeWidth="5" strokeLinecap="round"
            style={{ transition: 'all 0.6s ease' }} />
        )}
        {/* Value text */}
        <text x={cx} y={cy - 6} textAnchor="middle" fill={gaugeColor} fontSize="16" fontWeight="700" fontFamily="JetBrains Mono">
          {typeof value === 'number' ? (value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : value.toFixed(0)) : '--'}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fill="#444" fontSize="8" fontFamily="Inter">{unit}</text>
      </svg>
      <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{label}</div>
      {/* Percentage bar */}
      <div style={{ height: 2, background: '#151a28', borderRadius: 1, marginTop: 8 }}>
        <div style={{ height: '100%', borderRadius: 1, background: gaugeColor, width: `${pct * 100}%`, transition: 'width 0.6s ease', opacity: 0.6 }} />
      </div>
    </div>
  )
}

export default function LiveData() {
  const [reading, setReading] = useState(null)
  const [prevReading, setPrevReading] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const load = () => fetchLatest().then(d => {
      setReading(prev => { setPrevReading(prev); return d?.reading })
    }).catch(() => {})
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id) }, [])

  const r = reading || {}
  const tds = useAnim(r.tds || 0)
  const turb = useAnim(r.turbidity || 0)
  const nit = useAnim(r.nitrate || 0)
  const ph = useAnim(r.ph || 0)
  const temp = useAnim(r.temperature || 0)
  const lvl = useAnim(r.level || 0)
  const rgb = r.rgb || [0, 0, 0]
  const sensorMode = r.sensor_mode || '--'

  /* Determine danger thresholds */
  const tdsDanger = tds > 700
  const turbDanger = turb > 3.5
  const nitDanger = nit > 25

  return (
    <div className="page-fade">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Live Data</h2>
            <p>Real-time sensor readings with animated gauges</p>
          </div>
          <span className="live-indicator"><span className="live-dot" /> Receiving data</span>
        </div>
      </div>

      {/* Sensor Mode Indicator */}
      <div style={{ background: '#0d1117', border: `1px solid ${sensorMode === 'pH' ? '#6c5ce7' : '#ffaa00'}40`, borderRadius: 10, padding: '10px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, transition: 'border-color 0.5s' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: sensorMode === 'pH' ? '#6c5ce7' : '#ffaa00', animation: 'highPulse 1.5s infinite' }} />
        <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.6 }}>Color Sensor Mode:</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: sensorMode === 'pH' ? '#6c5ce7' : '#ffaa00' }}>
          {sensorMode === 'pH' ? '🧪 pH Measurement' : sensorMode === 'Nitrate' ? '🔬 Nitrate Measurement' : '--'}
        </span>
        <span style={{ fontSize: 10, color: '#333', marginLeft: 'auto' }}>Alternates every 60s</span>
      </div>

      {/* Main sensor gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <ArcGauge value={tds} max={1000} label="TDS" unit="ppm" color="#f0f0f0" danger={tdsDanger} />
        <ArcGauge value={turb} max={5} label="Turbidity" unit="NTU" color="#888888" danger={turbDanger} />
        <ArcGauge value={nit} max={50} label="Nitrate" unit="ppm" color={sensorMode === 'Nitrate' ? '#ffaa00' : '#333'} danger={nitDanger} />
        <ArcGauge value={ph} max={14} label="pH" unit="pH" color={sensorMode === 'pH' ? '#6c5ce7' : '#333'} />
        <ArcGauge value={temp} max={40} label="Temperature" unit="°C" color="#44cc66" />
        <ArcGauge value={lvl} max={500} label="Water Level" unit="mm" color="#2090b0" />
      </div>

      {/* Secondary info row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {/* GPS */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>GPS Position</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#888' }}>
            {r.latitude?.toFixed(6) ?? '--'}<br />{r.longitude?.toFixed(6) ?? '--'}
          </div>
        </div>

        {/* RGB Swatch */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>RGB Color</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: `rgb(${rgb.join(',')})`, border: '1px solid #222', transition: 'background 0.6s ease' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#666' }}>
              R:{rgb[0]}<br />G:{rgb[1]}<br />B:{rgb[2]}
            </div>
          </div>
        </div>

        {/* Quality */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Quality Label</div>
          <span className={`badge badge-${r.quality_label?.toLowerCase()}`} style={{ fontSize: 14, padding: '6px 14px' }}>{r.quality_label || '--'}</span>
        </div>

        {/* Bloom */}
        <div style={{ background: '#0d1117', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Bloom Risk</div>
          <span className={`badge badge-${r.bloom_risk?.toLowerCase()}`} style={{ fontSize: 14, padding: '6px 14px' }}>{r.bloom_risk || '--'}</span>
        </div>
      </div>

      {/* Timestamp */}
      <div style={{ marginTop: 16, fontSize: 11, color: '#222', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
        Last reading: {r.timestamp ? new Date(r.timestamp).toLocaleString() : '--'} | Refresh #{tick}
      </div>
    </div>
  )
}
