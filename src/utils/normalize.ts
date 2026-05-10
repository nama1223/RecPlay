/**
 * Audio normalization utility.
 *
 * Two modes:
 *   normalizeFile   — whole-file normalization using a pre-scanned peakLevel
 *                     (stored during waveform generation). One download pass only.
 *   normalizeSection — per-section normalization with a 2-pass approach:
 *                     pass 1 scans the section peak, pass 2 encodes with gain.
 *
 * Chunk strategy (same as waveformCompute):
 *   - Audio is decoded in 5-min chunks to stay under Chrome's 50M-sample limit.
 *   - Each chunk byte range is fetched via fetchRange(), which internally splits
 *     into ≤2MB sub-requests to respect the Worker's range cap.
 *
 * Output format: MP3 at 128 kbps via lamejs.
 */

import { Mp3Encoder } from 'lamejs'
import { fetchRange } from './waveformCompute'

const DECODE_CHUNK_SECS = 300          // same as waveform
const MP3_FRAME_SIZE = 1152            // samples per MP3 frame
const TARGET_LEVEL = 0.95             // normalize to ~-0.45 dBFS (safety headroom)
const MP3_BITRATE = 128               // kbps

// ── helpers ──────────────────────────────────────────────────────────────────

function f32ToI16(val: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(val * 32767)))
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function buildMp3Blob(parts: Int8Array[]): Blob {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) { merged.set(p, off); off += p.length }
  return new Blob([merged], { type: 'audio/mpeg' })
}

// ── audio processing ─────────────────────────────────────────────────────────

/**
 * Scan a byte range for the true peak (max |sample|).
 * Also returns sample rate and channel count from the first decoded chunk.
 */
async function scanPeak(
  url: string,
  bStart: number, bEnd: number,
  chunkBytes: number,
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
 * Decode a byte range, apply gain, and encode to MP3.
 * Appends encoded frames to mp3Parts.
 */
async function encodeWithGain(
  url: string,
  bStart: number, bEnd: number,
  chunkBytes: number,
  gain: number,
  encoder: Mp3Encoder,
  mp3Parts: Int8Array[],
  onProgress?: (pct: number) => void,
): Promise<void> {
  const rangeLen = bEnd - bStart + 1
  const numChunks = Math.ceil(rangeLen / chunkBytes)
  const actx = new AudioContext()
  try {
    for (let c = 0; c < numChunks; c++) {
      const cs = bStart + c * chunkBytes
      const ce = Math.min(cs + chunkBytes - 1, bEnd)
      try {
        const raw = await fetchRange(url, cs, ce)
        const decoded = await actx.decodeAudioData(raw)
        const ch0 = decoded.getChannelData(0)
        const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null
        const leftI16 = new Int16Array(ch0.length)
        const rightI16 = ch1 ? new Int16Array(ch1.length) : null
        for (let i = 0; i < ch0.length; i++) {
          leftI16[i] = f32ToI16(ch0[i] * gain)
          if (rightI16 && ch1) rightI16[i] = f32ToI16(ch1[i] * gain)
        }
        // Feed to MP3 encoder in frame-size chunks
        for (let i = 0; i < leftI16.length; i += MP3_FRAME_SIZE) {
          const l = leftI16.subarray(i, i + MP3_FRAME_SIZE)
          const r = rightI16?.subarray(i, i + MP3_FRAME_SIZE)
          const buf = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l)
          if (buf.length > 0) mp3Parts.push(buf)
        }
      } catch { /* skip bad chunk */ }
      onProgress?.(Math.round(((c + 1) / numChunks) * 100))
    }
  } finally { await actx.close().catch(() => {}) }
}

// ── public API ────────────────────────────────────────────────────────────────

export type NormPhase = 'encode' | 'scan'

/**
 * Normalize an entire file and download the result.
 * Uses the stored peakLevel (from waveform generation) — no extra scan pass needed.
 */
export async function normalizeFile(
  src: string,
  duration: number,
  fileKey: string,
  storedPeakLevel: number,
  onProgress: (pct: number, phase: NormPhase) => void,
): Promise<void> {
  const head = await fetch(src, { method: 'HEAD' })
  const fileSize = parseInt(head.headers.get('Content-Length') ?? '0')
  if (!fileSize) throw new Error('ファイルサイズを取得できません')

  const chunkBytes = Math.ceil((DECODE_CHUNK_SECS / duration) * fileSize)
  const gain = Math.min(TARGET_LEVEL / storedPeakLevel, 20) // cap gain at 20x

  // Probe format from the first chunk
  let sampleRate = 44100, channels = 2
  try {
    const probeEnd = Math.min(chunkBytes - 1, fileSize - 1)
    const probeRaw = await fetchRange(src, 0, probeEnd)
    const actx = new AudioContext()
    const decoded = await actx.decodeAudioData(probeRaw)
    sampleRate = decoded.sampleRate
    channels = decoded.numberOfChannels
    await actx.close()
  } catch { /* use defaults */ }

  const encoder = new Mp3Encoder(channels, sampleRate, MP3_BITRATE)
  const mp3Parts: Int8Array[] = []

  await encodeWithGain(src, 0, fileSize - 1, chunkBytes, gain, encoder, mp3Parts,
    (pct) => onProgress(pct, 'encode'))

  const tail = encoder.flush()
  if (tail.length > 0) mp3Parts.push(tail)

  const baseName = fileKey.split('/').pop() ?? 'normalized'
  const outName = baseName.replace(/\.[^.]+$/, '') + '_normalized.mp3'
  triggerDownload(buildMp3Blob(mp3Parts), outName)
}

/**
 * Normalize a section and download the result (2-pass: scan then encode).
 */
export async function normalizeSection(
  src: string,
  startTime: number,
  endTime: number,
  duration: number,
  sectionLabel: string,
  onProgress: (pct: number, phase: NormPhase) => void,
): Promise<void> {
  const head = await fetch(src, { method: 'HEAD' })
  const fileSize = parseInt(head.headers.get('Content-Length') ?? '0')
  if (!fileSize) throw new Error('ファイルサイズを取得できません')

  const bStart = Math.floor((startTime / duration) * fileSize)
  const bEnd = Math.min(Math.ceil((endTime / duration) * fileSize) - 1, fileSize - 1)
  const sectionDuration = endTime - startTime
  const chunkBytes = Math.ceil((Math.min(DECODE_CHUNK_SECS, sectionDuration) / sectionDuration) * (bEnd - bStart + 1))

  // Pass 1: scan peak
  const { peak, sampleRate, channels } = await scanPeak(src, bStart, bEnd, chunkBytes,
    (pct) => onProgress(pct, 'scan'))
  if (peak <= 0) throw new Error('ピークを検出できませんでした')

  const gain = Math.min(TARGET_LEVEL / peak, 20)

  // Pass 2: encode with gain
  const encoder = new Mp3Encoder(channels, sampleRate, MP3_BITRATE)
  const mp3Parts: Int8Array[] = []

  await encodeWithGain(src, bStart, bEnd, chunkBytes, gain, encoder, mp3Parts,
    (pct) => onProgress(pct, 'encode'))

  const tail = encoder.flush()
  if (tail.length > 0) mp3Parts.push(tail)

  triggerDownload(buildMp3Blob(mp3Parts), `${sectionLabel}_normalized.mp3`)
}
