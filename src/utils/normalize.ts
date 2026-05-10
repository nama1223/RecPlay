/**
 * Audio normalization — parallel Web Worker edition.
 *
 * Architecture:
 *   - File is split into PARALLELISM segments (up to 4, based on CPU cores).
 *   - Each segment runs in its own EncodeWorker concurrently → ~N× speedup.
 *   - Within each segment, chunk N+1 fetch/decode overlaps with Worker encoding chunk N.
 *   - Both normalizeFile and normalizeSection overwrite the R2 file in-place.
 *
 * normalizeFile    — 1-pass: uses stored peakLevel, encodes entire file in parallel.
 * normalizeSection — 3-phase: scan section peak → parallel re-encode full file
 *                    (gain applied only to section time range) → upload.
 */

import { fetchRange } from './waveformCompute'
import { WORKER_URL } from '../config'

const DECODE_CHUNK_SECS = 300   // 5-min chunks (Chrome 50M-sample limit)
const MP3_BITRATE      = 128    // kbps

// Number of parallel encode Workers. Capped at 4 to stay within Chrome's
// AudioContext limit (~6) and avoid excessive memory pressure.
const PARALLELISM = Math.min(
  Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1),
  4,
)

/** Normalize target peak (exported so callers can update stored peakLevel). */
export const NORMALIZE_TARGET_LEVEL = 0.95  // ~-0.45 dBFS
const TARGET_LEVEL = NORMALIZE_TARGET_LEVEL

// ── helpers ──────────────────────────────────────────────────────────────────

function f32ToI16(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
}

function buildMp3Blob(parts: Uint8Array[]): Blob {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) { merged.set(p, off); off += p.length }
  return new Blob([merged], { type: 'audio/mpeg' })
}

async function getFileSize(src: string): Promise<number> {
  const head = await fetch(src, { method: 'HEAD' })
  const cl = parseInt(head.headers.get('Content-Length') ?? '0')
  if (cl > 0) return cl
  const r = await fetch(src, { headers: { Range: 'bytes=0-0' } })
  const cr = r.headers.get('Content-Range')
  const total = cr ? parseInt(cr.split('/')[1] ?? '0') : 0
  if (total > 0) return total
  throw new Error('ファイルサイズを取得できません')
}

async function uploadToR2(blob: Blob, fileKey: string): Promise<void> {
  const presignRes = await fetch(`${WORKER_URL}/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: fileKey }),
  })
  if (!presignRes.ok) throw new Error(`プリサインURL取得失敗 (${presignRes.status})`)
  const { url } = await presignRes.json() as { url: string }
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: blob,
  })
  if (!putRes.ok) throw new Error(`R2アップロード失敗 (${putRes.status})`)
}

// ── Web Worker wrapper ────────────────────────────────────────────────────────

/** Promise-based wrapper around encodeWorker. One request at a time. */
class EncodeWorker {
  private w: Worker
  private resolve: ((v: MessageEvent['data']) => void) | null = null

  constructor() {
    this.w = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' })
    this.w.onmessage = (e) => { this.resolve?.(e.data); this.resolve = null }
  }

  private rpc<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
    return new Promise((res) => { this.resolve = res as (v: any) => void; this.w.postMessage(msg, transfer) })
  }

  async init(channels: number, sampleRate: number, bitrate: number) {
    await this.rpc({ type: 'init', channels, sampleRate, bitrate })
  }

  async encode(left: Int16Array, right: Int16Array | null): Promise<Uint8Array> {
    const transfer: Transferable[] = [left.buffer]
    if (right) transfer.push(right.buffer)
    const { dataBuf } = await this.rpc<{ dataBuf: ArrayBuffer }>(
      { type: 'encode', leftBuf: left.buffer, rightBuf: right?.buffer ?? null }, transfer)
    return new Uint8Array(dataBuf)
  }

  async flush(): Promise<Uint8Array> {
    const { dataBuf } = await this.rpc<{ dataBuf: ArrayBuffer }>({ type: 'flush' })
    return new Uint8Array(dataBuf)
  }

  terminate() { this.w.terminate() }
}

// ── audio processing ─────────────────────────────────────────────────────────

/** Scan a byte range for the true peak, sampleRate, channels. */
async function scanPeak(
  url: string, bStart: number, bEnd: number, chunkBytes: number,
  onProgress?: (pct: number) => void,
): Promise<{ peak: number; sampleRate: number; channels: number }> {
  const rangeLen = bEnd - bStart + 1
  const numChunks = Math.ceil(rangeLen / chunkBytes)
  let peak = 0, sampleRate = 44100, channels = 2
  const actx = new AudioContext()
  try {
    for (let c = 0; c < numChunks; c++) {
      const cs = bStart + c * chunkBytes
      const ce = Math.min(cs + chunkBytes - 1, bEnd)
      try {
        const raw = await fetchRange(url, cs, ce)
        const decoded = await actx.decodeAudioData(raw)
        if (c === 0) { sampleRate = decoded.sampleRate; channels = decoded.numberOfChannels }
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch)
          for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i])
            if (abs > peak) peak = abs
          }
        }
      } catch { /* skip bad chunk boundary */ }
      onProgress?.(Math.round(((c + 1) / numChunks) * 100))
    }
  } finally { await actx.close().catch(() => {}) }
  return { peak, sampleRate, channels }
}

/**
 * Encode one contiguous segment of chunks [chunkStart, chunkEnd) in a dedicated Worker.
 * Uses 1-ahead pipeline: fetch/decode chunk N+1 while Worker encodes chunk N.
 *
 * sampleOffset — estimated first sample index for this segment (for gainFn timing).
 */
async function encodeSegment(
  url: string,
  fileSize: number,
  chunkStart: number,
  chunkEnd: number,
  chunkBytes: number,
  sampleRate: number,
  channels: number,
  sampleOffset: number,
  gainFn: (timeSec: number) => number,
  onProgress?: (chunksCompleted: number) => void,
): Promise<Uint8Array[]> {
  const numChunks = chunkEnd - chunkStart
  if (numChunks <= 0) return []

  const ew = new EncodeWorker()
  const parts: Uint8Array[] = []
  let accumulated = sampleOffset
  const actx = new AudioContext()

  const fetchDecode = async (localIdx: number): Promise<AudioBuffer | null> => {
    try {
      const globalChunk = chunkStart + localIdx
      const cs = globalChunk * chunkBytes
      const ce = Math.min(cs + chunkBytes - 1, fileSize - 1)
      if (cs >= fileSize) return null
      const raw = await fetchRange(url, cs, ce)
      return await actx.decodeAudioData(raw)
    } catch { return null }
  }

  try {
    await ew.init(channels, sampleRate, MP3_BITRATE)
    let pending = fetchDecode(0)

    for (let c = 0; c < numChunks; c++) {
      // Start next fetch NOW — runs concurrently with everything below
      const next = c + 1 < numChunks ? fetchDecode(c + 1) : Promise.resolve(null)

      const decoded = await pending
      if (decoded) {
        const ch0 = decoded.getChannelData(0)
        const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null
        const leftI16  = new Int16Array(ch0.length)
        const rightI16 = ch1 ? new Int16Array(ch1.length) : null
        for (let i = 0; i < ch0.length; i++) {
          const g = gainFn((accumulated + i) / sampleRate)
          leftI16[i] = f32ToI16(ch0[i] * g)
          if (rightI16 && ch1) rightI16[i] = f32ToI16(ch1[i] * g)
        }
        accumulated += ch0.length

        // Send to Worker — while awaiting, `next` fetch runs concurrently
        const encoded = await ew.encode(leftI16, rightI16)
        if (encoded.length > 0) parts.push(encoded)
      }

      pending = next
      onProgress?.(c + 1)
    }

    const tail = await ew.flush()
    if (tail.length > 0) parts.push(tail)
  } finally {
    ew.terminate()
    await actx.close().catch(() => {})
  }

  return parts
}

/**
 * Parallel pipeline encode.
 * Splits the file into up to PARALLELISM segments, each encoded in its own Worker
 * concurrently. Returns ordered MP3 byte chunks ready to concatenate.
 *
 * gainFn(timeSec) → gain multiplier for samples at that time position.
 *   whole-file: () => gain
 *   section:    (t) => inSection(t) ? gain : 1.0
 */
async function encodeFullFile(
  url: string,
  fileSize: number,
  chunkBytes: number,
  sampleRate: number,
  channels: number,
  gainFn: (timeSec: number) => number,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array[]> {
  const numChunks = Math.ceil(fileSize / chunkBytes)
  const parallelism = Math.max(1, Math.min(PARALLELISM, numChunks))
  const chunksPerSeg = Math.ceil(numChunks / parallelism)
  // Approximate samples per chunk (exact count varies by decoder, but close enough for gainFn)
  const samplesPerChunk = Math.round(DECODE_CHUNK_SECS * sampleRate)

  // Per-segment progress tracking
  const segDone  = new Array(parallelism).fill(0)
  const segTotal: number[] = []

  const tasks = Array.from({ length: parallelism }, (_, wi) => {
    const cs = wi * chunksPerSeg
    const ce = Math.min(cs + chunksPerSeg, numChunks)
    segTotal.push(ce - cs)
    return encodeSegment(
      url, fileSize, cs, ce, chunkBytes, sampleRate, channels,
      cs * samplesPerChunk,
      gainFn,
      (done) => {
        segDone[wi] = done
        const totalDone   = segDone.reduce((a, b) => a + b, 0)
        const totalChunks = segTotal.reduce((a, b) => a + b, 0)
        onProgress?.(Math.round((totalDone / totalChunks) * 100))
      },
    )
  })

  const results = await Promise.all(tasks)
  return results.flat()
}

// ── public API ────────────────────────────────────────────────────────────────

export type NormPhase = 'scan' | 'encode' | 'upload'

/**
 * Normalize entire file and overwrite in R2.
 * 1-pass encode using stored peakLevel, parallelized across CPU cores.
 */
export async function normalizeFile(
  src: string,
  duration: number,
  fileKey: string,
  storedPeakLevel: number,
  onProgress: (pct: number, phase: NormPhase) => void,
): Promise<void> {
  const fileSize = await getFileSize(src)
  const chunkBytes = Math.ceil((DECODE_CHUNK_SECS / duration) * fileSize)
  const gain = Math.min(TARGET_LEVEL / storedPeakLevel, 20)

  // Probe format from first chunk
  let sampleRate = 44100, channels = 2
  try {
    const probeRaw = await fetchRange(src, 0, Math.min(chunkBytes - 1, fileSize - 1))
    const actx = new AudioContext()
    const d = await actx.decodeAudioData(probeRaw)
    sampleRate = d.sampleRate; channels = d.numberOfChannels
    await actx.close()
  } catch { /* use defaults */ }

  const parts = await encodeFullFile(
    src, fileSize, chunkBytes, sampleRate, channels,
    () => gain,
    (pct) => onProgress(pct, 'encode'),
  )

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(parts), fileKey)
  onProgress(100, 'upload')
}

/**
 * Normalize a section in-place.
 * Re-encodes the full file in parallel, applying gain only to samples in [startTime, endTime].
 * Phases: scan → encode → upload
 */
export async function normalizeSection(
  src: string,
  startTime: number,
  endTime: number,
  duration: number,
  fileKey: string,
  onProgress: (pct: number, phase: NormPhase) => void,
): Promise<void> {
  const fileSize = await getFileSize(src)
  const chunkBytes = Math.ceil((DECODE_CHUNK_SECS / duration) * fileSize)

  // Pass 1: scan section peak
  const sectionDur = endTime - startTime
  const bStart = Math.floor((startTime / duration) * fileSize)
  const bEnd   = Math.min(Math.ceil((endTime / duration) * fileSize) - 1, fileSize - 1)
  const scanChunk = Math.ceil((Math.min(DECODE_CHUNK_SECS, sectionDur) / sectionDur) * (bEnd - bStart + 1))

  const { peak, sampleRate, channels } = await scanPeak(src, bStart, bEnd, scanChunk,
    (pct) => onProgress(pct, 'scan'))
  if (peak <= 0) throw new Error('ピークを検出できませんでした')

  const gain = Math.min(TARGET_LEVEL / peak, 20)
  const gainFn = (t: number) => (t >= startTime && t <= endTime) ? gain : 1.0

  // Pass 2: encode full file in parallel with selective gain
  const parts = await encodeFullFile(
    src, fileSize, chunkBytes, sampleRate, channels,
    gainFn,
    (pct) => onProgress(pct, 'encode'),
  )

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(parts), fileKey)
  onProgress(100, 'upload')
}
