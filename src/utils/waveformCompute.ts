/**
 * Chunked waveform computation.
 *
 * Splits the audio into 5-minute chunks, fetches each as a byte range,
 * and decodes with AudioContext.decodeAudioData (avoids Chrome's 50M-sample
 * AudioBuffer limit that caused EncodingError on files > ~19 minutes).
 *
 * - Partial waveform is displayed after every chunk via onProgress
 * - Resume state is auto-saved to localStorage so interrupted generation
 *   can continue from where it stopped
 */

/** Seconds of audio decoded per chunk (stays under Chrome's 50 M sample limit) */
const CHUNK_SECS = 300
/** Worker caps per Range request at 2 MB */
const WORKER_RANGE_CAP = 2 * 1024 * 1024

// ── helpers ──────────────────────────────────────────────────────────────────

/** Fetch a byte range, issuing multiple sub-requests if the Worker caps them. */
async function fetchRange(url: string, start: number, end: number): Promise<ArrayBuffer> {
  const parts: ArrayBuffer[] = []
  let pos = start
  while (pos <= end) {
    const rangeEnd = Math.min(pos + WORKER_RANGE_CAP - 1, end)
    const res = await fetch(url, { headers: { Range: `bytes=${pos}-${rangeEnd}` } })
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    parts.push(await res.arrayBuffer())
    pos = rangeEnd + 1
  }
  if (parts.length === 1) return parts[0]
  const total = parts.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(new Uint8Array(p), off); off += p.byteLength }
  return out.buffer
}

/** Compute RMS per-second bins from one channel. */
function binChannel(data: Float32Array, numBins: number): Float32Array {
  const out = new Float32Array(numBins)
  const binSize = Math.max(1, Math.floor(data.length / numBins))
  for (let i = 0; i < numBins; i++) {
    let rms = 0
    const from = i * binSize
    const to = Math.min(from + binSize, data.length)
    if (to <= from) continue
    for (let j = from; j < to; j++) rms += data[j] * data[j]
    out[i] = Math.sqrt(rms / (to - from))
  }
  return out
}

/** Return a normalized copy of rawBins (max=1) for display. */
function normalize(raw: Float32Array): Float32Array {
  const d = new Float32Array(raw)
  let peak = 0
  for (let i = 0; i < d.length; i++) if (d[i] > peak) peak = d[i]
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak
  return d
}

// ── resume state ─────────────────────────────────────────────────────────────

interface ResumeState {
  pct: number
  completedChunks: number
  rawBins: number[]
}

export function getWaveformResumeInfo(resumeKey: string): { pct: number } | null {
  try {
    const s = localStorage.getItem(resumeKey)
    if (!s) return null
    const d: ResumeState = JSON.parse(s)
    if (d.completedChunks > 0 && d.pct < 100) return { pct: d.pct }
  } catch { /* ignore */ }
  return null
}

export function clearWaveformResume(resumeKey: string) {
  localStorage.removeItem(resumeKey)
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * Compute a waveform for `audioUrl` (must be a URL with Range-request support).
 *
 * @param onProgress  Called after each chunk with (pct 0-100, normalised bins for display)
 * @param resumeKey   localStorage key — if set, progress is saved automatically and
 *                    previous progress is resumed.  Call clearWaveformResume() first
 *                    if you want to start fresh.
 */
export async function computeWaveform(
  audioUrl: string,
  duration: number,
  onProgress?: (pct: number, displayBins: Float32Array) => void,
  resumeKey?: string,
): Promise<Float32Array> {
  const BINS = Math.ceil(duration)
  const numChunks = Math.ceil(duration / CHUNK_SECS)

  // Load resume state if available
  let resumeState: ResumeState | null = null
  if (resumeKey) {
    try {
      const s = localStorage.getItem(resumeKey)
      if (s) resumeState = JSON.parse(s)
    } catch { /* ignore */ }
  }

  const rawBins = resumeState?.rawBins
    ? new Float32Array(resumeState.rawBins)
    : new Float32Array(BINS)
  const startChunk = resumeState?.completedChunks ?? 0

  // Report existing progress immediately on resume
  if (startChunk > 0) {
    onProgress?.(Math.round((startChunk / numChunks) * 100), normalize(rawBins))
  }

  // Get file size (needed for byte-range calculation)
  const head = await fetch(audioUrl, { method: 'HEAD' })
  const fileSize = parseInt(head.headers.get('Content-Length') ?? '0')
  if (!fileSize) throw new Error('ファイルサイズを取得できませんでした')

  const actx = new AudioContext()
  try {
    for (let c = startChunk; c < numChunks; c++) {
      const tStart = c * CHUNK_SECS
      const tEnd = Math.min((c + 1) * CHUNK_SECS, duration)

      // Byte offsets are estimated; accurate for CBR, approximate for VBR
      const bStart = Math.floor((tStart / duration) * fileSize)
      const bEnd = Math.min(Math.ceil((tEnd / duration) * fileSize) - 1, fileSize - 1)

      const raw = await fetchRange(audioUrl, bStart, bEnd)

      let decoded: AudioBuffer
      try {
        decoded = await actx.decodeAudioData(raw)
      } catch {
        // Chunk boundary split an unreadable frame — skip and leave bins as 0
        console.warn(`[waveform] chunk ${c + 1}/${numChunks} decode failed, skipping`)
        continue
      }

      // Pick the channel with the larger dynamic range
      const ch0 = decoded.getChannelData(0)
      const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null
      const numBins = Math.ceil(Math.min(decoded.duration, tEnd - tStart))
      const b0 = binChannel(ch0, numBins)
      const b1 = ch1 ? binChannel(ch1, numBins) : null
      let chunkBins = b0
      if (b1) {
        let p0 = 0, p1 = 0
        for (const v of b0) if (v > p0) p0 = v
        for (const v of b1) if (v > p1) p1 = v
        if (p1 > p0) chunkBins = b1
      }

      const binOffset = Math.floor(tStart)
      for (let i = 0; i < chunkBins.length; i++) {
        const idx = binOffset + i
        if (idx < BINS) rawBins[idx] = chunkBins[i]
      }

      const pct = Math.round(((c + 1) / numChunks) * 100)
      const display = normalize(rawBins)
      onProgress?.(pct, display)

      // Auto-save resume state after each chunk
      if (resumeKey) {
        const state: ResumeState = { pct, completedChunks: c + 1, rawBins: Array.from(rawBins) }
        try { localStorage.setItem(resumeKey, JSON.stringify(state)) } catch { /* quota */ }
      }
    }
  } finally {
    await actx.close().catch(() => {})
  }

  if (resumeKey) localStorage.removeItem(resumeKey)

  // Final normalization
  let peak = 0
  for (let i = 0; i < rawBins.length; i++) if (rawBins[i] > peak) peak = rawBins[i]
  if (peak > 0) for (let i = 0; i < rawBins.length; i++) rawBins[i] /= peak
  return rawBins
}

export function serializeWaveform(samples: Float32Array, duration: number) {
  return { samples: Array.from(samples), duration, generatedAt: new Date().toISOString() }
}

export function deserializeWaveform(data: { samples: number[] }): Float32Array {
  return new Float32Array(data.samples)
}
