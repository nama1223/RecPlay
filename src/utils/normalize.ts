/**
 * Audio normalization — parallel Web Worker edition.
 *
 * Architecture:
 *   - File is split into PARALLELISM segments (up to 4, based on CPU cores).
 *   - Each segment runs in its own EncodeWorker concurrently.
 *   - Each Worker does decode + gain + encode entirely in its thread (main thread is free).
 *   - Main thread only fetches raw compressed bytes and transfers them to Workers.
 *   - Within each segment, chunk N+1 fetch overlaps with Worker processing chunk N.
 *
 * normalizeFile    — 1-pass: uses stored peakLevel, encodes entire file in parallel.
 * normalizeSection — 3-phase: scan section peak → parallel re-encode full file
 *                    (gain applied only to section time range) → upload.
 */

import { fetchRange } from './waveformCompute'
import { WORKER_URL } from '../config'

const DECODE_CHUNK_SECS = 300   // 5-min chunks
const MP3_BITRATE      = 128    // kbps

// Parallel Workers: min(CPU cores - 1, 4).
// Capped at 4 to avoid excessive memory pressure (~100 MB per Worker per chunk).
const PARALLELISM = Math.min(
  Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1),
  4,
)

/** Normalize target peak (exported so callers can update stored peakLevel). */
export const NORMALIZE_TARGET_LEVEL = 0.95  // ~-0.45 dBFS
const TARGET_LEVEL = NORMALIZE_TARGET_LEVEL

// ── helpers ──────────────────────────────────────────────────────────────────

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

  /**
   * New path: send raw compressed bytes to Worker.
   * Worker decodes → applies gain → encodes → returns MP3 bytes.
   * Main thread is free while Worker runs.
   */
  async process(
    rawBuf: ArrayBuffer,
    sampleOffset: number,
    gainConst: number,
    sectionGain: number | null,
    sectionStartSamp: number,
    sectionEndSamp: number,
  ): Promise<Uint8Array> {
    const { dataBuf } = await this.rpc<{ dataBuf: ArrayBuffer }>(
      { type: 'process', rawBuf, sampleOffset, gainConst, sectionGain, sectionStartSamp, sectionEndSamp },
      [rawBuf],
    )
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
  // OfflineAudioContext works for decodeAudioData and doesn't count against the
  // real AudioContext limit (max 6 in Chrome).
  const actx = new OfflineAudioContext(2, 1, 44100)
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
  return { peak, sampleRate, channels }
}

/**
 * Encode one contiguous segment of chunks [chunkStart, chunkEnd) in a dedicated Worker.
 *
 * The Worker receives raw compressed bytes (zero-copy transfer) and does
 * decode + gain application + MP3 encode entirely in its own thread.
 * Main thread only handles fetching (network I/O, non-blocking).
 *
 * 1-ahead pipeline: fetch chunk N+1 while Worker processes chunk N.
 */
async function encodeSegment(
  url: string,
  fileSize: number,
  chunkStart: number,
  chunkEnd: number,
  chunkBytes: number,
  sampleRate: number,
  channels: number,
  samplesPerChunk: number,
  gainConst: number,
  sectionGain: number | null,
  sectionStartSamp: number,
  sectionEndSamp: number,
  onProgress?: (chunksCompleted: number) => void,
): Promise<Uint8Array[]> {
  const numChunks = chunkEnd - chunkStart
  if (numChunks <= 0) return []

  const ew = new EncodeWorker()
  const parts: Uint8Array[] = []

  /** Fetch raw compressed bytes for one chunk (no decoding on main thread). */
  const fetchRaw = async (localIdx: number): Promise<ArrayBuffer | null> => {
    try {
      const globalChunk = chunkStart + localIdx
      const cs = globalChunk * chunkBytes
      const ce = Math.min(cs + chunkBytes - 1, fileSize - 1)
      if (cs >= fileSize) return null
      return await fetchRange(url, cs, ce)
    } catch { return null }
  }

  try {
    await ew.init(channels, sampleRate, MP3_BITRATE)

    // Kick off chunk 0 fetch before the loop starts
    let pending = fetchRaw(0)

    for (let c = 0; c < numChunks; c++) {
      // Start chunk N+1 fetch NOW — runs concurrently with Worker processing chunk N
      const next = c + 1 < numChunks ? fetchRaw(c + 1) : Promise.resolve(null)

      const raw = await pending
      if (raw) {
        const sampleOffset = (chunkStart + c) * samplesPerChunk
        // Transfer raw bytes to Worker (zero-copy).
        // Worker decodes + applies gain + encodes — main thread is free.
        const encoded = await ew.process(
          raw, sampleOffset, gainConst, sectionGain, sectionStartSamp, sectionEndSamp,
        )
        if (encoded.length > 0) parts.push(encoded)
      }

      pending = next
      onProgress?.(c + 1)
    }

    const tail = await ew.flush()
    if (tail.length > 0) parts.push(tail)
  } finally {
    ew.terminate()
  }

  return parts
}

/**
 * Parallel encode: splits file into PARALLELISM segments, each in its own Worker.
 * Returns ordered MP3 byte chunks ready to concatenate.
 *
 * gainConst      — gain for all samples (normalizeFile) or outside-section samples (normalizeSection)
 * sectionGain    — gain inside the section; null = constant gain for whole file
 * sectionStart/EndSamp — section boundary in samples (used only when sectionGain != null)
 */
async function encodeFullFile(
  url: string,
  fileSize: number,
  chunkBytes: number,
  sampleRate: number,
  channels: number,
  gainConst: number,
  sectionGain: number | null,
  sectionStartSamp: number,
  sectionEndSamp: number,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array[]> {
  const numChunks = Math.ceil(fileSize / chunkBytes)
  const parallelism = Math.max(1, Math.min(PARALLELISM, numChunks))
  const chunksPerSeg = Math.ceil(numChunks / parallelism)
  // Approximate sample count per chunk (for gainFn time offset; exact count varies slightly)
  const samplesPerChunk = Math.round(DECODE_CHUNK_SECS * sampleRate)

  const segDone  = new Array(parallelism).fill(0)
  const segTotal: number[] = []

  const tasks = Array.from({ length: parallelism }, (_, wi) => {
    const cs = wi * chunksPerSeg
    const ce = Math.min(cs + chunksPerSeg, numChunks)
    segTotal.push(ce - cs)
    return encodeSegment(
      url, fileSize, cs, ce, chunkBytes, sampleRate, channels,
      samplesPerChunk, gainConst, sectionGain, sectionStartSamp, sectionEndSamp,
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

  // Probe audio format from first chunk (OfflineAudioContext — no real audio device needed)
  let sampleRate = 44100, channels = 2
  try {
    const probeRaw = await fetchRange(src, 0, Math.min(chunkBytes - 1, fileSize - 1))
    const actx = new OfflineAudioContext(2, 1, 44100)
    const d = await actx.decodeAudioData(probeRaw)
    sampleRate = d.sampleRate; channels = d.numberOfChannels
  } catch { /* use defaults */ }

  // Constant gain across entire file — sectionGain = null
  const parts = await encodeFullFile(
    src, fileSize, chunkBytes, sampleRate, channels,
    gain, null, 0, 0,
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
  // Outside section → gainConst = 1.0, inside section → sectionGain = gain
  const sectionStartSamp = Math.round(startTime * sampleRate)
  const sectionEndSamp   = Math.round(endTime   * sampleRate)

  // Pass 2: encode full file in parallel with selective gain
  const parts = await encodeFullFile(
    src, fileSize, chunkBytes, sampleRate, channels,
    1.0, gain, sectionStartSamp, sectionEndSamp,
    (pct) => onProgress(pct, 'encode'),
  )

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(parts), fileKey)
  onProgress(100, 'upload')
}
