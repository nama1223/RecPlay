/**
 * Audio normalization — pipeline + Web Worker edition.
 *
 * Architecture:
 *   - Encoding runs in a dedicated Web Worker (non-blocking for UI).
 *   - While the Worker encodes chunk N, the main thread concurrently
 *     fetches + decodes chunk N+1 (1-ahead pipeline).
 *   - Both normalizeFile and normalizeSection overwrite the R2 file in-place.
 *
 * normalizeFile    — 1-pass: uses stored peakLevel, encodes entire file.
 * normalizeSection — 3-phase: scan section peak → re-encode full file
 *                    (gain applied only to section time range) → upload.
 */

import { fetchRange } from './waveformCompute'
import { WORKER_URL } from '../config'

const DECODE_CHUNK_SECS = 300   // 5-min chunks (Chrome 50M-sample limit)
const MP3_BITRATE      = 128    // kbps

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
 * Pipeline encode: fetch/decode chunk N+1 concurrently while Worker encodes chunk N.
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
  ew: EncodeWorker,
  mp3Parts: Uint8Array[],
  onProgress?: (pct: number) => void,
): Promise<void> {
  const numChunks = Math.ceil(fileSize / chunkBytes)
  let accumulated = 0
  const actx = new AudioContext()

  /** Fetch one chunk and decode. Returns null on error (skip). */
  const fetchDecode = async (c: number): Promise<AudioBuffer | null> => {
    try {
      const cs = c * chunkBytes
      const ce = Math.min(cs + chunkBytes - 1, fileSize - 1)
      const raw = await fetchRange(url, cs, ce)
      return await actx.decodeAudioData(raw)
    } catch { return null }
  }

  try {
    // Kick off chunk 0 fetch before the loop starts
    let pending = fetchDecode(0)

    for (let c = 0; c < numChunks; c++) {
      // Start chunk N+1 fetch NOW — runs concurrently with everything below
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

        // Send to Worker — while awaiting, `next` fetch runs on main thread
        const encoded = await ew.encode(leftI16, rightI16)
        if (encoded.length > 0) mp3Parts.push(encoded)
      }

      pending = next
      onProgress?.(Math.round(((c + 1) / numChunks) * 100))
    }
  } finally { await actx.close().catch(() => {}) }
}

// ── public API ────────────────────────────────────────────────────────────────

export type NormPhase = 'scan' | 'encode' | 'upload'

/**
 * Normalize entire file and overwrite in R2.
 * 1-pass encode using stored peakLevel.
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

  const ew = new EncodeWorker()
  try {
    await ew.init(channels, sampleRate, MP3_BITRATE)
    const parts: Uint8Array[] = []
    await encodeFullFile(src, fileSize, chunkBytes, sampleRate, channels,
      () => gain, ew, parts,
      (pct) => onProgress(pct, 'encode'))
    const tail = await ew.flush()
    if (tail.length > 0) parts.push(tail)

    onProgress(0, 'upload')
    await uploadToR2(buildMp3Blob(parts), fileKey)
    onProgress(100, 'upload')
  } finally { ew.terminate() }
}

/**
 * Normalize a section in-place.
 * Re-encodes the full file, applying gain only to samples in [startTime, endTime].
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

  // Pass 2: encode full file with selective gain
  const ew = new EncodeWorker()
  try {
    await ew.init(channels, sampleRate, MP3_BITRATE)
    const parts: Uint8Array[] = []
    await encodeFullFile(src, fileSize, chunkBytes, sampleRate, channels,
      gainFn, ew, parts,
      (pct) => onProgress(pct, 'encode'))
    const tail = await ew.flush()
    if (tail.length > 0) parts.push(tail)

    onProgress(0, 'upload')
    await uploadToR2(buildMp3Blob(parts), fileKey)
    onProgress(100, 'upload')
  } finally { ew.terminate() }
}
