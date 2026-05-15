/**
 * Audio normalization — parallel Web Worker edition.
 *
 * Architecture:
 *   - File split into PARALLELISM segments (up to 4, based on CPU cores).
 *   - Each segment runs in its own EncodeWorker concurrently.
 *   - Main thread: fetch compressed bytes → decodeAudioData → transfer Float32Array to Worker.
 *   - Worker: apply gain + f32→i16 + lamejs encode (all CPU work off main thread).
 *   - 1-ahead pipeline: fetch chunk N+1 while Worker processes chunk N.
 *
 * normalizeFile         — 1-pass: uses stored peakLevel, encodes entire file in parallel.
 * normalizeSection      — 3-phase: scan section peak → parallel re-encode full file
 *                         (gain applied only to section time range) → upload.
 * restoreSampleRate44to48 — re-encodes a file wrongly tagged as 44.1 kHz back to 48 kHz.
 */

import { fetchRange } from './waveformCompute'
import { WORKER_URL, MP3_BITRATE } from '../config'

const DECODE_CHUNK_SECS = 300   // 5-min chunks (Chrome 50M-sample limit)

// Parallel Workers: min(CPU cores - 1, 4).
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

/**
 * Parse the first valid MPEG-1 MP3 frame header and return sample rate in Hz.
 * Reads raw bytes directly — no AudioContext, no resampling risk.
 * Returns null if no valid header is found.
 */
function parseMp3SampleRate(bytes: Uint8Array): number | null {
  const mpeg1Rates = [44100, 48000, 32000] as const
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] !== 0xFF) continue
    const b1 = bytes[i + 1]
    if ((b1 & 0xE0) !== 0xE0) continue        // sync: top 11 bits must be 1
    const version = (b1 >> 3) & 0x3            // 11=MPEG-1, 10=MPEG-2, 01=reserved, 00=MPEG-2.5
    if (version !== 3) continue                 // only MPEG-1 handled here
    const layer = (b1 >> 1) & 0x3             // 01=Layer III (MP3), others = I/II
    if (layer === 0) continue                   // reserved
    const srIdx = (bytes[i + 2] >> 2) & 0x3   // sample rate index
    if (srIdx === 3) continue                   // reserved
    return mpeg1Rates[srIdx]
  }
  return null
}

/**
 * Probe the source file's true sample rate (via MP3 frame header) and channel count.
 * Fetches up to 128 KB to skip large ID3 tags.
 * Does NOT rely on AudioContext.sampleRate (which resamples to the context rate).
 */
async function probeSrcFormat(
  src: string,
  fileSize: number,
): Promise<{ sampleRate: number; channels: number }> {
  const probeEnd = Math.min(131071, fileSize - 1)
  const raw = await fetchRange(src, 0, probeEnd)

  // Sample rate: read from MP3 frame header bits (immune to AudioContext resampling)
  const sampleRate = parseMp3SampleRate(new Uint8Array(raw)) ?? 44100

  // Channel count: decode a small chunk using the correct sample rate
  // so the AudioContext does not resample (sampleRate of context matches source)
  let channels = 2
  try {
    const actx = new OfflineAudioContext(2, 1, sampleRate)
    const d = await actx.decodeAudioData(raw.slice(0))  // slice: decodeAudioData may transfer
    channels = d.numberOfChannels
  } catch { /* use default stereo */ }

  return { sampleRate, channels }
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
   * Send decoded Float32 PCM to Worker (zero-copy transfer).
   * Worker applies gain, converts f32→i16, and lamejs-encodes.
   */
  async processF32(
    leftF32Buf: ArrayBuffer,
    rightF32Buf: ArrayBuffer | null,
    sampleOffset: number,
    gainConst: number,
    sectionGain: number | null,
    sectionStartSamp: number,
    sectionEndSamp: number,
  ): Promise<Uint8Array> {
    const transfer: Transferable[] = [leftF32Buf]
    if (rightF32Buf) transfer.push(rightF32Buf)
    const { dataBuf } = await this.rpc<{ dataBuf: ArrayBuffer }>(
      { type: 'processF32', leftF32Buf, rightF32Buf, sampleOffset,
        gainConst, sectionGain, sectionStartSamp, sectionEndSamp },
      transfer,
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

/** Scan a byte range for the true peak level. */
async function scanPeak(
  url: string, bStart: number, bEnd: number, chunkBytes: number,
  sourceSampleRate: number,
  onProgress?: (pct: number) => void,
): Promise<{ peak: number }> {
  const rangeLen = bEnd - bStart + 1
  const numChunks = Math.ceil(rangeLen / chunkBytes)
  let peak = 0
  // Use the source's true sample rate so the context doesn't resample
  const actx = new OfflineAudioContext(2, 1, sourceSampleRate)
  for (let c = 0; c < numChunks; c++) {
    const cs = bStart + c * chunkBytes
    const ce = Math.min(cs + chunkBytes - 1, bEnd)
    try {
      const raw = await fetchRange(url, cs, ce)
      const decoded = await actx.decodeAudioData(raw)
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
  return { peak }
}

/**
 * Encode one contiguous segment of chunks [chunkStart, chunkEnd) in a dedicated Worker.
 *
 * sampleRate — source file's true sample rate; AudioContext is created at this rate
 *              to prevent the browser from resampling during decodeAudioData.
 * encodeAs   — sample rate to write into the MP3 header (normally equals sampleRate;
 *              pass a different value only for the 44.1→48 kHz restore operation).
 *
 * Main thread: fetch compressed bytes → decodeAudioData → copy Float32 → transfer to Worker.
 * Worker: apply gain + f32→i16 + lamejs encode (pure CPU, off main thread).
 * 1-ahead: fetch chunk N+1 while Worker encodes chunk N.
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
  encodeAs: number,
  onProgress?: (chunksCompleted: number) => void,
): Promise<Uint8Array[]> {
  const numChunks = chunkEnd - chunkStart
  if (numChunks <= 0) return []

  const ew = new EncodeWorker()
  const parts: Uint8Array[] = []
  // Key fix: specify sampleRate so Chrome does NOT resample the decoded audio
  const actx = new AudioContext({ sampleRate })

  /** Fetch + decode one chunk. Returns null on error (skip). */
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
    // encodeAs = sample rate written into the MP3 header (usually same as sampleRate)
    await ew.init(channels, encodeAs, MP3_BITRATE)

    // Kick off chunk 0 fetch before the loop
    let pending = fetchDecode(0)

    for (let c = 0; c < numChunks; c++) {
      // Start chunk N+1 fetch NOW — runs concurrently with Worker processing chunk N
      const next = c + 1 < numChunks ? fetchDecode(c + 1) : Promise.resolve(null)

      const decoded = await pending
      if (decoded) {
        const ch0 = decoded.getChannelData(0)
        const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null

        // .slice() copies into a fresh ArrayBuffer so it can be transferred zero-copy to Worker
        const leftF32Buf  = ch0.slice().buffer
        const rightF32Buf = ch1 ? ch1.slice().buffer : null

        const sampleOffset = (chunkStart + c) * samplesPerChunk

        // Transfer to Worker: gain + f32→i16 + encode all happen in Worker thread
        const encoded = await ew.processF32(
          leftF32Buf, rightF32Buf, sampleOffset,
          gainConst, sectionGain, sectionStartSamp, sectionEndSamp,
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
    await actx.close().catch(() => {})
  }

  return parts
}

/**
 * Parallel encode: splits file into PARALLELISM segments, each in its own Worker.
 * Returns ordered MP3 byte chunks ready to concatenate.
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
  encodeAs: number,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array[]> {
  const numChunks = Math.ceil(fileSize / chunkBytes)
  const parallelism = Math.max(1, Math.min(PARALLELISM, numChunks))
  const chunksPerSeg = Math.ceil(numChunks / parallelism)
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
      encodeAs,
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

  // Probe true sample rate from MP3 frame header (avoids AudioContext resampling)
  const { sampleRate, channels } = await probeSrcFormat(src, fileSize)

  // Constant gain across entire file (sectionGain = null); encode at source sample rate
  const parts = await encodeFullFile(
    src, fileSize, chunkBytes, sampleRate, channels,
    gain, null, 0, 0, sampleRate,
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

  // Probe true sample rate and channels first
  const { sampleRate, channels } = await probeSrcFormat(src, fileSize)

  // Pass 1: scan section peak using the correct sample rate
  const sectionDur = endTime - startTime
  const bStart = Math.floor((startTime / duration) * fileSize)
  const bEnd   = Math.min(Math.ceil((endTime / duration) * fileSize) - 1, fileSize - 1)
  const scanChunk = Math.ceil((Math.min(DECODE_CHUNK_SECS, sectionDur) / sectionDur) * (bEnd - bStart + 1))

  const { peak } = await scanPeak(src, bStart, bEnd, scanChunk, sampleRate,
    (pct) => onProgress(pct, 'scan'))
  if (peak <= 0) throw new Error('ピークを検出できませんでした')

  const gain = Math.min(TARGET_LEVEL / peak, 20)
  const sectionStartSamp = Math.round(startTime * sampleRate)
  const sectionEndSamp   = Math.round(endTime   * sampleRate)

  // Pass 2: encode full file in parallel with selective gain
  // gainConst = 1.0 (outside section), sectionGain = gain (inside section)
  const parts = await encodeFullFile(
    src, fileSize, chunkBytes, sampleRate, channels,
    1.0, gain, sectionStartSamp, sectionEndSamp, sampleRate,
    (pct) => onProgress(pct, 'encode'),
  )

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(parts), fileKey)
  onProgress(100, 'upload')
}

/**
 * Restore a file that was incorrectly encoded at 44.1 kHz back to 48 kHz.
 *
 * Background: if normalization ran when AudioContext defaulted to 44.1 kHz but the
 * source was 48 kHz, the probe returned 44.1 kHz and lamejs tagged the MP3 as 44.1 kHz
 * even though the PCM data came from a 48 kHz decode.  The result plays back slower
 * and at a lower pitch (duration ≈ original × 48000/44100).
 *
 * Fix strategy:
 *   - Decode the wrong file with AudioContext({ sampleRate: 44100 }) — no resampling,
 *     so we get back exactly the original 48 kHz PCM samples.
 *   - Re-encode with lamejs tagged as 48000 Hz.
 *   - The caller must scale all section times by (44100 / 48000) ≈ 0.9188.
 */
export async function restoreSampleRate44to48(
  src: string,
  duration: number,
  fileKey: string,
  onProgress: (pct: number, phase: NormPhase) => void,
): Promise<void> {
  const fileSize = await getFileSize(src)
  const chunkBytes = Math.ceil((DECODE_CHUNK_SECS / duration) * fileSize)

  // Decode at 44100 (the wrong current rate, no resampling)
  // Encode as 48000 (the true original rate)
  const parts = await encodeFullFile(
    src, fileSize, chunkBytes,
    44100,  // sampleRate: AudioContext rate = source file's claimed rate (no resample)
    2,      // channels: assume stereo
    1.0, null, 0, 0,
    48000,  // encodeAs: tag the output MP3 as 48 kHz
    (pct) => onProgress(pct, 'encode'),
  )

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(parts), fileKey)
  onProgress(100, 'upload')
}
