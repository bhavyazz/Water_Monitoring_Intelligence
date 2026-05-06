import { useState, useEffect, useRef, useMemo } from 'react'
import { fetchLatest } from '../api'
import { TIME_SERIES } from '../data/syntheticData'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Area, AreaChart, Tooltip } from 'recharts'

/* Petri dish cell simulation */
function useCells(count, radius) {
  const cellsRef = useRef([])

  useEffect(() => {
    const existing = cellsRef.current
    if (existing.length < count) {
      for (let i = existing.length; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const r = Math.random() * (radius - 10)
        cellsRef.current.push({
          x: radius + r * Math.cos(angle), y: radius + r * Math.sin(angle),
          vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8,
          size: 1.5 + Math.random() * 2, opacity: 0, fadingIn: true,
        })
      }
    } else if (existing.length > count) {
      // Mark excess cells for fade-out
      for (let i = count; i < existing.length; i++) existing[i].fadingOut = true
    }
  }, [count, radius])

  return cellsRef
}

function PetriDish({ risk, cellCount, nitrate, temp }) {
  const R = 120
  const cellsRef = useCells(cellCount, R)
  const canvasRef = useRef(null)
  const animRef = useRef(null)

  const riskColors = { LOW: '#2288aa', MODERATE: '#44aa66', HIGH: '#33cc44', CRITICAL: '#22aa22' }
  const glowColor = risk === 'CRITICAL' ? '#ff4455' : risk === 'HIGH' ? '#44ff88' : 'transparent'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const cx = W / 2, cy = H / 2

    const draw = () => {
      ctx.clearRect(0, 0, W, H)

      // Dish background
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fillStyle = '#060a14'; ctx.fill()
      ctx.strokeStyle = risk === 'CRITICAL' ? '#ff445540' : '#1a2332'; ctx.lineWidth = 2; ctx.stroke()

      // Glow on HIGH/CRITICAL
      if (risk === 'HIGH' || risk === 'CRITICAL') {
        const grad = ctx.createRadialGradient(cx, cy, R - 10, cx, cy, R + 5)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(1, glowColor + '20')
        ctx.beginPath(); ctx.arc(cx, cy, R + 5, 0, Math.PI * 2)
        ctx.fillStyle = grad; ctx.fill()
      }

      const cells = cellsRef.current
      const toRemove = []

      cells.forEach((c, i) => {
        // Fade in
        if (c.fadingIn) { c.opacity = Math.min(1, c.opacity + 0.03); if (c.opacity >= 1) c.fadingIn = false }
        // Fade out
        if (c.fadingOut) { c.opacity = Math.max(0, c.opacity - 0.03); if (c.opacity <= 0) { toRemove.push(i); return } }

        // Move
        c.x += c.vx; c.y += c.vy
        // Bounce off dish boundary
        const dx = c.x - R, dy = c.y - R
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > R - 5) {
          const nx = dx / dist, ny = dy / dist
          c.vx -= 2 * (c.vx * nx + c.vy * ny) * nx
          c.vy -= 2 * (c.vx * nx + c.vy * ny) * ny
          c.x = R + (R - 6) * (dx / dist); c.y = R + (R - 6) * (dy / dist)
        }
        // Random perturbation
        c.vx += (Math.random() - 0.5) * 0.15
        c.vy += (Math.random() - 0.5) * 0.15
        // Speed limit
        const spd = Math.sqrt(c.vx * c.vx + c.vy * c.vy)
        const maxSpd = risk === 'CRITICAL' ? 2 : risk === 'HIGH' ? 1.5 : 0.8
        if (spd > maxSpd) { c.vx = (c.vx / spd) * maxSpd; c.vy = (c.vy / spd) * maxSpd }

        // Draw cell
        ctx.beginPath(); ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2)
        ctx.fillStyle = riskColors[risk] || '#2288aa'
        ctx.globalAlpha = c.opacity * 0.7
        ctx.fill()
        ctx.globalAlpha = 1
      })

      // Remove faded-out cells
      for (let i = toRemove.length - 1; i >= 0; i--) cells.splice(toRemove[i], 1)

      animRef.current = requestAnimationFrame(draw)
    }
    animRef.current = requestAnimationFrame(draw)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [risk, glowColor])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <canvas ref={canvasRef} width={R * 2} height={R * 2} style={{ borderRadius: '50%', border: risk === 'CRITICAL' ? '2px solid #ff445540' : '2px solid #1a2332' }} />
      <div style={{ fontSize: 10, color: '#444', marginTop: 8 }}>{cellCount} cells — {risk}</div>
    </div>
  )
}

export default function BloomLab() {
  const [latest, setLatest] = useState(null)

  useEffect(() => {
    const load = () => fetchLatest().then(d => setLatest(d?.reading)).catch(() => {})
    load(); const id = setInterval(load, 3000); return () => clearInterval(id)
  }, [])

  const nit = latest?.nitrate ?? 15
  const temp = latest?.temperature ?? 26
  const risk = nit > 25 && temp > 30 ? 'CRITICAL' : nit > 20 && temp > 28 ? 'HIGH' : nit > 12 ? 'MODERATE' : 'LOW'
  const cellCount = { LOW: 20, MODERATE: 80, HIGH: 300, CRITICAL: 600 }[risk]

  /* Logistic growth model */
  const K = 5000 // carrying capacity
  const r = 0.05 + (nit / 50) * 0.15 + (temp / 35) * 0.1 // growth rate
  const N = cellCount // current pop
  const dNdt = r * N * (1 - N / K)

  /* Days until visible bloom (N=1000) */
  const daysUntilBloom = N >= 1000 ? 0 : Math.max(0, Math.log((1000 * (K - N)) / (N * (K - 1000))) / r).toFixed(1)
  const daysColor = daysUntilBloom < 5 ? '#ff4455' : daysUntilBloom < 15 ? '#ffaa00' : '#44cc66'

  /* 30-day projection */
  const projection = useMemo(() => {
    const data = []
    let pop = N
    for (let d = 0; d <= 30; d++) {
      data.push({ day: d, population: Math.round(pop), visible: 1000, toxic: 3000 })
      pop = pop + r * pop * (1 - pop / K)
      pop = Math.max(0, Math.min(K, pop))
    }
    return data
  }, [N, r, K])

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Bloom Lab</h2>
        <p>Living algal growth simulation with predictive modeling</p>
      </div>

      {/* Top: Petri dish + equation + countdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 200px', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PetriDish risk={risk} cellCount={cellCount} nitrate={nit} temp={temp} />
        </div>

        {/* Growth equation */}
        <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Verhulst Logistic Growth Model</div>
          <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', color: '#666', marginBottom: 16 }}>
            dN/dt = <span style={{ color: '#00d4ff' }}>r</span>N(1 - N/<span style={{ color: '#ffaa00' }}>K</span>)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'r (growth rate)', value: r.toFixed(4), color: '#00d4ff' },
              { label: 'N (population)', value: N, color: '#44cc66' },
              { label: 'K (capacity)', value: K, color: '#ffaa00' },
              { label: 'dN/dt', value: dNdt.toFixed(1), color: '#bb66ff' },
            ].map(v => (
              <div key={v.label}>
                <div style={{ fontSize: 9, color: '#333', marginBottom: 2 }}>{v.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: v.color }}>{v.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Countdown */}
        <div style={{ background: '#0d1117', border: `1px solid ${daysColor}20`, borderRadius: 12, padding: 20, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Days Until Bloom</div>
          <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'var(--font-mono)', color: daysColor, animation: daysUntilBloom < 5 ? 'highPulse 1.5s infinite' : 'none' }}>
            {daysUntilBloom == 0 ? 'NOW' : daysUntilBloom}
          </div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>{daysUntilBloom == 0 ? 'Bloom in progress' : 'estimated'}</div>
        </div>
      </div>

      {/* Projection chart */}
      <div style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>30-Day Population Projection</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={projection}>
            <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
            <XAxis dataKey="day" tick={{ fill: '#333', fontSize: 9 }} label={{ value: 'Days', position: 'bottom', fill: '#333', fontSize: 9 }} />
            <YAxis tick={{ fill: '#333', fontSize: 9 }} />
            <Tooltip contentStyle={{ background: '#0a0e16', border: '1px solid #1a2332', borderRadius: 8, fontSize: 11 }} />
            <Area type="monotone" dataKey="population" stroke="#44cc66" fill="#44cc66" fillOpacity={0.1} strokeWidth={2} animationDuration={800} />
            <ReferenceLine y={1000} stroke="#ffaa00" strokeDasharray="6 4" label={{ value: 'Visible bloom', fill: '#ffaa00', fontSize: 9, position: 'right' }} />
            <ReferenceLine y={3000} stroke="#ff4455" strokeDasharray="6 4" label={{ value: 'Toxic level', fill: '#ff4455', fontSize: 9, position: 'right' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Synced parameter charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {[
          { key: 'nitrate', label: 'Nitrate', color: '#ffaa00', th: 25 },
          { key: 'temperature', label: 'Temperature', color: '#44cc66', th: 30 },
          { key: 'greenChannel', label: 'Green Channel', color: '#00cc88', th: 120 },
        ].map(ch => (
          <div key={ch.key} style={{ background: '#0d1117', border: '1px solid #1a2332', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{ch.label}</div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={TIME_SERIES}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
                <XAxis dataKey="time" tick={{ fill: '#222', fontSize: 7 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#222', fontSize: 7 }} />
                <ReferenceLine y={ch.th} stroke="#ff445550" strokeDasharray="4 3" />
                <Area type="monotone" dataKey={ch.key} stroke={ch.color} fill={ch.color} fillOpacity={0.08} strokeWidth={1.5} dot={false} animationDuration={600} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  )
}
