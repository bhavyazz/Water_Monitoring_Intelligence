import { useState } from 'react'
import { SOURCES, FINGERPRINTS, BAR_DATA } from '../data/syntheticData'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
         RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts'

const TYPE_ICONS = {
  Factory: { emoji: '', color: '#ff4455', desc: 'Industrial manufacturing plant' },
  Farm: { emoji: '', color: '#44cc66', desc: 'Agricultural cultivation area' },
  Sewage: { emoji: '', color: '#ffaa00', desc: 'Municipal sewage treatment plant' },
  Landfill: { emoji: '', color: '#bb66ff', desc: 'Solid waste disposal site' },
}

const SRC_COLORS = { Factory: '#ff4455', Farm: '#44cc66', Sewage: '#ffaa00', Landfill: '#bb66ff' }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill || p.stroke }}>{p.name}: {p.value}</div>
      ))}
    </div>
  )
}

export default function EntityExtraction() {
  const [selectedType, setSelectedType] = useState(null)

  return (
    <div className="page-fade">
      <div className="page-header">
        <h2>Entity Extraction & Waste Analysis</h2>
        <p>Land-use entities detected via OpenStreetMap and their pollution characteristics</p>
      </div>

      {/* Entity cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginBottom: 28 }}>
        {SOURCES.map(s => {
          const info = TYPE_ICONS[s.type]
          const isActive = selectedType === s.type
          return (
            <div key={s.id} onClick={() => setSelectedType(isActive ? null : s.type)}
              style={{
                background: isActive ? '#12182a' : '#0d1117', border: `1px solid ${isActive ? info.color + '60' : '#1a1a2e'}`,
                borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'all 0.3s ease',
                transform: isActive ? 'scale(1.02)' : 'scale(1)',
              }}>
              {/* Icon */}
              <div style={{ width: 36, height: 36, borderRadius: 8, background: info.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={info.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {s.type === 'Factory' && <><path d="M5 20V10l4 3V10l4 3V6h4v14" /><path d="M3 20h18" /></>}
                  {s.type === 'Farm' && <><path d="M12 3c0 0 5 4 5 9M12 3c0 0-5 4-5 9M12 3v18M5 21h14" /></>}
                  {s.type === 'Sewage' && <><circle cx="12" cy="10" r="5" /><path d="M7 18h10M9 21h6" /><path d="M12 5V2" /></>}
                  {s.type === 'Landfill' && <><path d="M6 20l3-12h6l3 12" /><path d="M9 12h6M8 16h8" /></>}
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: info.color, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>{info.desc}</div>
              <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Waste Products</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {s.waste.map(w => (
                  <span key={w} style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 4,
                    background: info.color + '15', color: info.color, fontFamily: 'var(--font-mono)',
                  }}>{w}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Charts side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Grouped bar chart */}
        <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <h3>Pollution Contribution by Source Type</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={BAR_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="#151a28" />
              <XAxis dataKey="param" tick={{ fill: '#444', fontSize: 10 }} />
              <YAxis tick={{ fill: '#444', fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#666' }} />
              <Bar dataKey="Factory" fill="#ff4455" radius={[3, 3, 0, 0]} animationDuration={1200} />
              <Bar dataKey="Farm" fill="#44cc66" radius={[3, 3, 0, 0]} animationDuration={1200} />
              <Bar dataKey="Sewage" fill="#ffaa00" radius={[3, 3, 0, 0]} animationDuration={1200} />
              <Bar dataKey="Landfill" fill="#bb66ff" radius={[3, 3, 0, 0]} animationDuration={1200} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar chart */}
        <div className="chart-card" style={{ background: '#0d1117', border: '1px solid #1a1a2e' }}>
          <h3>Pollution Fingerprint Comparison</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={FINGERPRINTS}>
              <PolarGrid stroke="#1a1a2e" />
              <PolarAngleAxis dataKey="param" tick={{ fill: '#555', fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fill: '#333', fontSize: 9 }} domain={[0, 100]} />
              <Radar name="Factory" dataKey="Factory" stroke="#ff4455" fill="#ff4455" fillOpacity={0.15} strokeWidth={1.5} animationDuration={1200} />
              <Radar name="Farm" dataKey="Farm" stroke="#44cc66" fill="#44cc66" fillOpacity={0.15} strokeWidth={1.5} animationDuration={1200} />
              <Radar name="Sewage" dataKey="Sewage" stroke="#ffaa00" fill="#ffaa00" fillOpacity={0.15} strokeWidth={1.5} animationDuration={1200} />
              <Radar name="Landfill" dataKey="Landfill" stroke="#bb66ff" fill="#bb66ff" fillOpacity={0.15} strokeWidth={1.5} animationDuration={1200} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#666' }} />
              <Tooltip content={<CustomTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
