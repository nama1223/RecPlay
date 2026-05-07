import { useState, useEffect } from 'react'

const TARGET_RATE = 8000 // Hz for decoding – low rate = fast decode

export function useWaveform(src: string | null, duration: number) {
  const [samples, setSamples] = useState<Float32Array | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Only attempt for local blob URLs (remote R2 needs CORS to be enabled)
    if (!src || !src.startsWith('blob:') || duration <= 0) {
      setSamples(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setSamples(null)

    ;(async () => {
      try {
        const res = await fetch(src)
        const raw = await res.arrayBuffer()

        const numFrames = Math.ceil(duration * TARGET_RATE)
        const ctx = new OfflineAudioContext(1, numFrames, TARGET_RATE)
        const decoded = await ctx.decodeAudioData(raw)

        if (cancelled) return

        const data = decoded.getChannelData(0)
        const BINS = Math.ceil(duration) // one bin per second
        const binSize = Math.floor(data.length / BINS)
        const result = new Float32Array(BINS)

        for (let i = 0; i < BINS; i++) {
          let rms = 0
          for (let j = 0; j < binSize; j++) {
            rms += data[i * binSize + j] ** 2
          }
          result[i] = Math.sqrt(rms / binSize)
        }

        // Normalize 0–1
        const max = Math.max(...result)
        if (max > 0) {
          for (let i = 0; i < result.length; i++) result[i] /= max
        }

        if (!cancelled) setSamples(result)
      } catch {
        // Silently fail – waveform is optional
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [src, duration])

  return { samples, loading }
}
