import { useState, useEffect } from 'react'
import { WORKER_URL } from '../config'
import { computeWaveform, deserializeWaveform } from '../utils/waveformCompute'

/**
 * Load waveform samples and true peak level.
 * Priority:
 *   1. Pre-computed from Worker (if fileKey provided and waveform stored)
 *   2. Real-time decode from blob URL (local files, using chunked approach)
 *   3. null (remote file with no stored waveform)
 */
export function useWaveform(
  src: string | null,
  duration: number,
  fileKey: string | null,
) {
  const [samples, setSamples] = useState<Float32Array | null>(null)
  const [peakLevel, setPeakLevel] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasStored, setHasStored] = useState(false)

  useEffect(() => {
    setSamples(null)
    setPeakLevel(null)
    setHasStored(false)
    if (!src || duration <= 0) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      // 1. Try pre-computed waveform from Worker
      if (fileKey) {
        try {
          const res = await fetch(`${WORKER_URL}/waveform?file=${encodeURIComponent(fileKey)}`)
          if (!res.ok) {
            // Consume body to avoid ERR_ABORTED in DevTools
            await res.body?.cancel()
          } else if (!cancelled) {
            const data = await res.json()
            if (data?.samples?.length && !cancelled) {
              const { samples: s, peakLevel: pk } = deserializeWaveform(data)
              setSamples(s)
              setPeakLevel(pk > 0 ? pk : null)
              setHasStored(true)
              setLoading(false)
              return
            }
          }
        } catch {
          // No stored waveform — fall through
        }
      }

      if (cancelled) return

      // 2. Local blob URLs: chunked decode
      if (!src.startsWith('blob:')) {
        setLoading(false)
        return
      }

      try {
        const { samples: s } = await computeWaveform(src, duration, (_pct, partial) => {
          if (!cancelled) setSamples(partial)
        })
        if (!cancelled) setSamples(s)
        // peakLevel not needed for local blobs (normalization requires fileKey)
      } catch {
        // Silently fail — waveform is optional for local files
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [src, duration, fileKey])

  return { samples, setSamples, peakLevel, setPeakLevel, loading, hasStored }
}
