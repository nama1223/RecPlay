/**
 * Compute a downsampled waveform from an audio URL.
 *
 * Uses HTMLMediaElement + AnalyserNode played at 16x speed.
 * Avoids loading the entire file into memory at once, which would crash
 * on large files (Chrome's AudioBuffer limit is ~19 minutes @ 44100 Hz).
 *
 * - One bin per second of audio
 * - Each bin = peak RMS amplitude within that second
 * - Normalized so max bin = 1.0
 */
export async function computeWaveform(
  audioUrl: string,
  duration: number,
  onProgress?: (pct: number) => void,
): Promise<Float32Array> {
  onProgress?.(0)

  const BINS = Math.ceil(duration)
  const bins = new Float32Array(BINS)

  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  const bufferLength = analyser.fftSize
  const dataArray = new Float32Array(bufferLength)

  // Connect silent output so AudioContext stays running
  const silentGain = ctx.createGain()
  silentGain.gain.value = 0
  analyser.connect(silentGain)
  silentGain.connect(ctx.destination)

  const audio = new Audio()
  // CORS required for Worker URLs; harmless for blob:
  if (!audioUrl.startsWith('blob:')) audio.crossOrigin = 'anonymous'
  audio.src = audioUrl
  audio.volume = 0        // silent but still processed by Web Audio
  audio.preload = 'auto'
  audio.playbackRate = 16 // fast-forward to reduce real-time wait

  const source = ctx.createMediaElementSource(audio)
  source.connect(analyser)

  return new Promise<Float32Array>((resolve, reject) => {
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const cleanup = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      ctx.close().catch(() => {})
    }

    const finish = () => {
      cleanup()
      // Normalize so peak = 1.0
      let peak = 0
      for (let i = 0; i < bins.length; i++) if (bins[i] > peak) peak = bins[i]
      if (peak > 0) for (let i = 0; i < bins.length; i++) bins[i] /= peak
      onProgress?.(100)
      resolve(bins)
    }

    audio.addEventListener('error', () => {
      cleanup()
      reject(new Error('音声の読み込みに失敗しました'))
    }, { once: true })

    audio.addEventListener('ended', finish, { once: true })

    audio.addEventListener('canplay', async () => {
      await ctx.resume()

      // Poll every 20 ms; at 16x speed that covers 320 ms of audio per tick,
      // so each second of audio is sampled ~3 times — no bins are missed.
      pollTimer = setInterval(() => {
        const binIdx = Math.floor(audio.currentTime)
        if (binIdx >= 0 && binIdx < BINS) {
          analyser.getFloatTimeDomainData(dataArray)
          let rms = 0
          for (let i = 0; i < bufferLength; i++) rms += dataArray[i] * dataArray[i]
          const val = Math.sqrt(rms / bufferLength)
          if (val > bins[binIdx]) bins[binIdx] = val // keep peak within each second
        }
        onProgress?.(Math.min(99, Math.round((audio.currentTime / duration) * 100)))
      }, 20)

      try {
        await audio.play()
      } catch (e) {
        cleanup()
        reject(e)
      }
    }, { once: true })
  })
}

/** Serialize waveform to JSON-compatible object for storage */
export function serializeWaveform(samples: Float32Array, duration: number) {
  return { samples: Array.from(samples), duration, generatedAt: new Date().toISOString() }
}

/** Deserialize stored waveform back to Float32Array */
export function deserializeWaveform(data: { samples: number[] }): Float32Array {
  return new Float32Array(data.samples)
}
