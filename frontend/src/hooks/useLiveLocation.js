import { useState, useEffect } from 'react'
import { fetchLatest } from '../api'

export default function useLiveLocation() {
  const [sensor, setSensor] = useState(null)

  useEffect(() => {
    const load = () => fetchLatest().then(d => {
      const r = d?.reading
      if (r?.latitude && r?.longitude) {
        setSensor({
          lat: r.latitude,
          lon: r.longitude,
          tds: r.tds,
          turbidity: r.turbidity,
          ph: r.ph,
          temperature: r.temperature,
          wqi: r.contamination_score,
          quality: r.quality_label,
          bloom: r.bloom_risk,
        })
      }
    }).catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  return sensor
}
