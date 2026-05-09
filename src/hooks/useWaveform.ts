import { useState, useEffect } from 'react'
import { WORKER_URL } from '../config'
import { deserializeWaveform } from '../utils/waveformCompute'

const LOCAL_TARGET_RATE = 8000

/**
 * Load waveform samples.
 * Priority:
 *   1. Pre-computed from Worker (if fileKey provided and waveform stored)
 *   2. Real-time decode from blob URL (local files)
 *   3. null (remote file with no stored waveform)
 */
export function useWaveform(
  src: string | null,
  duration: number,
  fileKey: string | null,
) {
  const [samples, setSamples] = useState<Float32Array | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasStored, setHasStored] = useState(false)

  useEffect(() => {
    setSamples(null)
    setHasStored(false)
    if (!src || duration <= 0) return

    let cancelled = false

    ;(async () => {
      setLoading(true)

      // 1. Try pre-computed waveform from Worker
      if (fileKey) {
        try {
          const res = await fetch(`${WORKER_URL}/waveform?file=${encodeURIComponent(fileKey)}`)
          if (res.ok && !cancelled) {
            const data = await res.json()
            if (data?.samples?.length && !cancelled) {
              setSamples(deserializeWaveform(data))
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

      // 2. Real-time decode for local blob URLs
      if (!src.startsWith('blob:')) {
        setLoading(false)
        return
      }

      try {
        const res = await fetch(src)
        const raw = await res.arrayBuffer()
        if (cancelled) return

        const numFrames = Math.ceil(duration * LOCAL_TARGET_RATE)
        const ctx = new OfflineAudioContext(2, numFrames, LOCAL_TARGET_RATE)
        const decoded = await ctx.decodeAudioData(raw)
        if (cancelled) return

        const BINS = Math.ceil(duration)
        const ch0 = decoded.getChannelData(0)
        const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null
        const binSize = Math.floor(ch0.length / BINS)

        function computeBins(data: Float32Array): Float32Array {
          const bins = new Float32Array(BINS)
          for (let i = 0; i < BINS; i++) {
            let rms = 0
            const end = Math.min(i * binSize + binSize, data.length)
            for (let j = i * binSize; j < end; j++) rms += data[j] ** 2
            bins[i] = Math.sqrt(rms / binSize)
          }
          return bins
        }

        const bins0 = computeBins(ch0)
        const bins1 = ch1 ? computeBins(ch1) : null
        let result = bins0
        if (bins1 && Math.max(...bins1) > Math.max(...bins0)) result = bins1

        const peak = Math.max(...result)
        if (peak > 0) for (let i = 0; i < result.length; i++) result[i] /= peak

        if (!cancelled) setSamples(result)
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [src, duration, fileKey])

  return { samples, setSamples, loading, hasStored }
}
