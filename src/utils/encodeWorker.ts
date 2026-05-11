/// <reference lib="webworker" />
/**
 * Web Worker: MP3 encoding via lamejs.
 * Runs on a separate thread so encoding never blocks the main UI.
 *
 * Protocol (all messages are request/response pairs):
 *   init        { type:'init', channels, sampleRate, bitrate }
 *               → { type:'ready' }
 *
 *   processF32  { type:'processF32',
 *                 leftF32Buf:  ArrayBuffer,        — Float32 PCM left  (transferred)
 *                 rightF32Buf: ArrayBuffer | null, — Float32 PCM right (transferred, or null)
 *                 sampleOffset:    number,   — absolute sample index of first sample
 *                 gainConst:       number,   — gain outside section (or whole-file gain)
 *                 sectionGain:     number | null, — null = constant gain for whole file
 *                 sectionStartSamp: number,
 *                 sectionEndSamp:   number }
 *               → { type:'processedF32', dataBuf: ArrayBuffer }  (transferred MP3 bytes)
 *
 *   encode      { type:'encode', leftBuf: ArrayBuffer, rightBuf: ArrayBuffer|null }  (legacy Int16)
 *               → { type:'encoded', dataBuf: ArrayBuffer }
 *
 *   flush       { type:'flush' }
 *               → { type:'flushed', dataBuf: ArrayBuffer }   (transferred)
 */

import { Mp3Encoder } from '@breezystack/lamejs'

const FRAME = 1152  // MP3 samples per frame
let enc: InstanceType<typeof Mp3Encoder> | null = null

function f32ToI16(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
}

const post = (msg: object, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer)

function lamejsEncode(leftI16: Int16Array, rightI16: Int16Array | null): Uint8Array {
  const parts: Int8Array[] = []
  if (enc) {
    for (let i = 0; i < leftI16.length; i += FRAME) {
      const l = leftI16.subarray(i, i + FRAME)
      const r = rightI16?.subarray(i, i + FRAME)
      const buf = r ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l)
      if (buf.length > 0) parts.push(buf)
    }
  }
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

self.onmessage = ({ data: msg }: MessageEvent) => {
  // ── init ─────────────────────────────────────────────────────────────────
  if (msg.type === 'init') {
    enc = new Mp3Encoder(msg.channels, msg.sampleRate, msg.bitrate)
    post({ type: 'ready' })
    return
  }

  // ── processF32 ───────────────────────────────────────────────────────────
  // Main thread decoded → Float32 PCM transferred here.
  // Worker applies gain, converts f32→i16, and lamejs-encodes. All CPU work
  // happens in this thread, leaving the main thread free.
  if (msg.type === 'processF32') {
    const left  = new Float32Array(msg.leftF32Buf)
    const right = msg.rightF32Buf != null ? new Float32Array(msg.rightF32Buf) : null
    const { sampleOffset, gainConst, sectionGain, sectionStartSamp, sectionEndSamp } = msg

    const n = left.length
    const leftI16  = new Int16Array(n)
    const rightI16 = right ? new Int16Array(n) : null
    const hasSectionGain = sectionGain != null

    for (let i = 0; i < n; i++) {
      const absIdx = sampleOffset + i
      const g = hasSectionGain && absIdx >= sectionStartSamp && absIdx <= sectionEndSamp
        ? (sectionGain as number) : (gainConst as number)
      leftI16[i] = f32ToI16(left[i] * g)
      if (rightI16 && right) rightI16[i] = f32ToI16(right[i] * g)
    }

    const out = lamejsEncode(leftI16, rightI16)
    post({ type: 'processedF32', dataBuf: out.buffer }, [out.buffer])
    return
  }

  // ── encode (legacy Int16 path) ────────────────────────────────────────────
  if (msg.type === 'encode') {
    const left  = new Int16Array(msg.leftBuf)
    const right = msg.rightBuf != null ? new Int16Array(msg.rightBuf) : null
    const out = lamejsEncode(left, right)
    post({ type: 'encoded', dataBuf: out.buffer }, [out.buffer])
    return
  }

  // ── flush ─────────────────────────────────────────────────────────────────
  if (msg.type === 'flush') {
    const tail = enc ? enc.flush() : new Int8Array(0)
    enc = null
    const out = new Uint8Array(tail.length)
    out.set(tail)
    post({ type: 'flushed', dataBuf: out.buffer }, [out.buffer])
  }
}
