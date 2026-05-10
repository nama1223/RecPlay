/**
 * Audio normalization utility.
 *
 * Normalizes audio and overwrites the R2 file in-place (no download).
 *
 * normalizeFile   — whole-file normalization using stored peakLevel.
 *                   1-pass encode only.
 *
 * normalizeSection — section normalization, 3 phases:
 *                   1. scan peak in section byte range
 *                   2. re-encode FULL file, applying gain only to section samples
 *                   3. upload to R2 (overwriting original key)
 *
 * After upload completes the caller should reload the audio source.
 */

import { Mp3Encoder } from '@breezystack/lamejs'
import { fetchRange } from './waveformCompute'
import { WORKER_URL } from '../config'

const DECODE_CHUNK_SECS = 300          // 5-min chunks (Chrome 50M-sample limit)
const MP3_FRAME_SIZE = 1152            // samples per MP3 frame
const TARGET_LEVEL = 0.95             // normalize to ~-0.45 dBFS
const MP3_BITRATE = 128               // kbps

// ── helpers ──────────────────────────────────────────────────────────────────

function f32ToI16(val: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(val * 32767)))
}

function buildMp3Blob(parts: Int8Array[]): Blob {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) { merged.set(p, off); off += p.length }
  return new Blob([merged], { type: 'audio/mpeg' })
}

async function getFileSize(src: string): Promise<number> {
  const head = await fetch(src, { method: 'HEAD' })
  const clHead = parseInt(head.headers.get('Content-Length') ?? '0')
  if (clHead > 0) return clHead
  const rangeRes = await fetch(src, { headers: { Range: 'bytes=0-0' } })
  const cr = rangeRes.headers.get('Content-Range')
  const total = cr ? parseInt(cr.split('/')[1] ?? '0') : 0
  if (total > 0) return total
  throw new Error('ファイルサイズを取得できません')
}

/** Upload a blob to R2, overwriting the given key. */
async function uploadToR2(blob: Blob, fileKey: string): Promise<void> {
  const presignRes = await fetch(`${WORKER_URL}/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: fileKey }),
  })
  if (!presignRes.ok) throw new Error(`プリサインURL取得失敗 (${presignRes.status})`)
  const { url } = await presignRes.json() as { url: string; key: string }
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: blob,
  })
  if (!putRes.ok) throw new Error(`R2アップロード失敗 (${putRes.status})`)
}

// ── audio processing ─────────────────────────────────────────────────────────

/**
 * Scan a byte range for the true peak and audio format info.
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
 * Encode full file, applying gainFn(sampleTimeSec) to each sample.
 * For whole-file normalize: gainFn = () => gain
 * For section normalize:    gainFn = (t) => inSection(t) ? gain : 1.0
 */
async function encodeFullFile(
  url: string,
  fileSize: number,
  chunkBytes: number,
  sampleRate: number,
  channels: number,
  gainFn: (timeSec: number) => number,
  encoder: Mp3Encoder,
  mp3Parts: Int8Array[],
  onProgress?: (pct: number) => void,
): Promise<void> {
  const numChunks = Math.ceil(fileSize / chunkBytes)
  let accumulatedSamples = 0
  const actx = new AudioContext()
  try {
    for (let c = 0; c < numChunks; c++) {
      const cs = c * chunkBytes
      const ce = Math.min(cs + chunkBytes - 1, fileSize - 1)
      try {
        const raw = await fetchRange(url, cs, ce)
        const decoded = await actx.decodeAudioData(raw)
        const ch0 = decoded.getChannelData(0)
        const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null
        const leftI16 = new Int16Array(ch0.length)
        const rightI16 = ch1 ? new Int16Array(ch1.length) : null
        for (let i = 0; i < ch0.length; i++) {
          const g = gainFn((accumulatedSamples + i) / sampleRate)
          leftI16[i] = f32ToI16(ch0[i] * g)
          if (rightI16 && ch1) rightI16[i] = f32ToI16(ch1[i] * g)
        }
        accumulatedSamples += ch0.length
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

export type NormPhase = 'scan' | 'encode' | 'upload'

/**
 * Normalize entire file and overwrite in R2.
 * Uses stored peakLevel — no scan pass needed.
 */
export async function normalizeFile(
  src: string,
  duration: number,
  fileKey: string,
  storedPeakLevel: number,
  onProgress: (pct: number, phase: NormPhase) => void,
): Promise<void> {
  const fileSize = await getFileSize(src)
  if (!fileSize) throw new Error('ファイルサイズを取得できません')

  const chunkBytes = Math.ceil((DECODE_CHUNK_SECS / duration) * fileSize)
  const gain = Math.min(TARGET_LEVEL / storedPeakLevel, 20)

  // Probe sampleRate/channels from first chunk
  let sampleRate = 44100, channels = 2
  try {
    const probeRaw = await fetchRange(src, 0, Math.min(chunkBytes - 1, fileSize - 1))
    const actx = new AudioContext()
    const decoded = await actx.decodeAudioData(probeRaw)
    sampleRate = decoded.sampleRate
    channels = decoded.numberOfChannels
    await actx.close()
  } catch { /* use defaults */ }

  const encoder = new Mp3Encoder(channels, sampleRate, MP3_BITRATE)
  const mp3Parts: Int8Array[] = []

  await encodeFullFile(src, fileSize, chunkBytes, sampleRate, channels,
    () => gain,
    encoder, mp3Parts,
    (pct) => onProgress(pct, 'encode'))

  const tail = encoder.flush()
  if (tail.length > 0) mp3Parts.push(tail)

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(mp3Parts), fileKey)
  onProgress(100, 'upload')
}

/**
 * Normalize a section in-place: re-encodes full file with gain applied
 * only to samples within [startTime, endTime]. Overwrites R2 file.
 *
 * Phases: scan (section peak) → encode (full file) → upload
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
  if (!fileSize) throw new Error('ファイルサイズを取得できません')

  const chunkBytes = Math.ceil((DECODE_CHUNK_SECS / duration) * fileSize)

  // Pass 1: scan section peak
  const sectionDuration = endTime - startTime
  const bStart = Math.floor((startTime / duration) * fileSize)
  const bEnd = Math.min(Math.ceil((endTime / duration) * fileSize) - 1, fileSize - 1)
  const sectionChunkBytes = Math.ceil((Math.min(DECODE_CHUNK_SECS, sectionDuration) / sectionDuration) * (bEnd - bStart + 1))

  const { peak, sampleRate, channels } = await scanPeak(src, bStart, bEnd, sectionChunkBytes,
    (pct) => onProgress(pct, 'scan'))
  if (peak <= 0) throw new Error('ピークを検出できませんでした')

  const gain = Math.min(TARGET_LEVEL / peak, 20)
  const gainFn = (t: number) => (t >= startTime && t <= endTime) ? gain : 1.0

  // Pass 2: re-encode full file with selective gain
  const encoder = new Mp3Encoder(channels, sampleRate, MP3_BITRATE)
  const mp3Parts: Int8Array[] = []

  await encodeFullFile(src, fileSize, chunkBytes, sampleRate, channels,
    gainFn,
    encoder, mp3Parts,
    (pct) => onProgress(pct, 'encode'))

  const tail = encoder.flush()
  if (tail.length > 0) mp3Parts.push(tail)

  onProgress(0, 'upload')
  await uploadToR2(buildMp3Blob(mp3Parts), fileKey)
  onProgress(100, 'upload')
}
