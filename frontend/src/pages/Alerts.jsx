import { useState, useEffect } from 'react'
import { fetchAlerts } from '../api'

export default function Alerts() {
  const [data, setData] = useState(null)

  useEffect(() => {
    const load = () => fetchAlerts().then(setData)
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div className="page-header">
        <h2>Alerts</h2>
        <p>Water quality warnings and algal bloom notifications</p>
      </div>

      {data?.alert_count > 0 && (
        <div style={{ marginBottom: 20, fontSize: 12, color: '#888' }}>
          {data.alert_count} alert group{data.alert_count !== 1 ? 's' : ''} from recent readings
        </div>
      )}

      {data?.alerts?.slice().reverse().map((group, gi) => (
        <div key={gi}>
          {group.alerts.map((a, ai) => (
            <div className="alert-item" key={`${gi}-${ai}`}>
              <div style={{
                width: 3,
                minHeight: '100%',
                borderRadius: 2,
                background: a.level === 'CRITICAL' ? '#ff4444' : '#ffaa00',
                marginRight: 4,
                flexShrink: 0,
              }} />
              <div className="alert-info">
                <div className="alert-type">
                  <span className={`badge badge-${a.level?.toLowerCase()}`}>{a.level}</span>
                  <span style={{ marginLeft: 10, color: '#888', fontSize: 11, textTransform: 'uppercase' }}>
                    {a.type === 'water_quality' ? 'Water Quality' : 'Algal Bloom'}
                  </span>
                </div>
                <div className="alert-message" style={{ marginTop: 6 }}>
                  {a.message}
                </div>
              </div>
              <div className="alert-time">
                {group.timestamp ? new Date(group.timestamp).toLocaleTimeString() : '--'}
              </div>
            </div>
          ))}
        </div>
      ))}

      {(!data?.alerts || data.alerts.length === 0) && (
        <div className="empty-state">No alerts at this time. All readings are within safe parameters.</div>
      )}
    </>
  )
}
