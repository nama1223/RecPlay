/**
 * Compute a downsampled waveform from an audio URL.
 * - Uses OfflineAudioContext at low sample rate for speed
 * - Stereo: picks the channel with larger dynamic range (peak)
 * - Normalizes so the loudest bin = 1.0 (pseudo-normalize for quiet recordings)
 * - Returns one Float32Array with one bin per second of audio
 */
export async function computeWaveform(
  audioUrl: string,
  duration: number,
  onProgress?: (pct: number) => void,
): Promise<Float32Array> {
  onProgress?.(5)

  const res = await fetch(audioUrl)
  if (!res.ok) throw new Error(`音声の取得に失敗しました (${res.status})`)

  onProgress?.(30)
  const raw = await res.arrayBuffer()

  onProgress?.(55)

  // Decode at low sample rate — keeps memory and CPU low
  const TARGET_RATE = 8000
  const numFrames = Math.ceil(duration * TARGET_RATE)
  const numCh = 2 // request stereo so we can compare channels

  const actx = new OfflineAudioContext(numCh, numFrames, TARGET_RATE)
  const decoded = await actx.decodeAudioData(raw)

  onProgress?.(80)

  const BINS = Math.ceil(duration) // one bin per second
  const ch0 = decoded.getChannelData(0)
  const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null

  const binSize = Math.floor(ch0.length / BINS)

  // Compute RMS bins for each available channel
  function computeBins(data: Float32Array): Float32Array {
    const bins = new Float32Array(BINS)
    for (let i = 0; i < BINS; i++) {
      let rms = 0
      const end = Math.min(i * binSize + binSize, data.length)
      for (let j = i * binSize; j < end; j++) {
        rms += data[j] ** 2
      }
      bins[i] = Math.sqrt(rms / binSize)
    }
    return bins
  }

  const bins0 = computeBins(ch0)
  const bins1 = ch1 ? computeBins(ch1) : null

  // Pick channel with the larger peak (more dynamic range visible)
  let result = bins0
  if (bins1) {
    const peak0 = Math.max(...bins0)
    const peak1 = Math.max(...bins1)
    if (peak1 > peak0) result = bins1
  }

  // Normalize so max = 1.0 (makes quiet recordings visible too)
  const peak = Math.max(...result)
  if (peak > 0) {
    for (let i = 0; i < result.length; i++) result[i] /= peak
  }

  onProgress?.(100)
  return result
}

/** Serialize waveform to JSON-compatible object for storage */
export function serializeWaveform(samples: Float32Array, duration: number) {
  return { samples: Array.from(samples), duration, generatedAt: new Date().toISOString() }
}

/** Deserialize stored waveform back to Float32Array */
export function deserializeWaveform(data: { samples: number[] }): Float32Array {
  return new Float32Array(data.samples)
}
