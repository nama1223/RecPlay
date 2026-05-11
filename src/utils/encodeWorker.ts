/// <reference lib="webworker" />
/**
 * Web Worker: MP3 encoding via lamejs.
 * Runs on a separate thread so encoding never blocks the main UI.
 *
 * Protocol (all messages are request/response pairs):
 *   init    { type:'init',    channels, sampleRate, bitrate }
 *           → { type:'ready' }
 *
 *   process { type:'process', rawBuf: ArrayBuffer,   — raw compressed audio bytes (transferred)
 *                              sampleOffset: number,  — sample index at start of this chunk
 *                              gainConst: number,     — gain for samples outside section (or whole file)
 *                              sectionGain: number|null, — gain inside section (null = constant gain)
 *                              sectionStartSamp: number,
 *                              sectionEndSamp: number }
 *           → { type:'processed', dataBuf: ArrayBuffer }  (transferred, zero-copy MP3 bytes)
 *
 *   encode  { type:'encode', leftBuf: ArrayBuffer, rightBuf: ArrayBuffer|null }  (legacy, Int16 input)
 *           → { type:'encoded', dataBuf: ArrayBuffer }
 *
 *   flush   { type:'flush' }
 *           → { type:'flushed', dataBuf: ArrayBuffer }   (transferred)
 */

import { Mp3Encoder } from '@breezystack/lamejs'

const FRAME = 1152  // MP3 samples per frame
let enc: InstanceType<typeof Mp3Encoder> | null = null
let _channels = 2
let _sampleRate = 44100

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

self.onmessage = async ({ data: msg }: MessageEvent) => {
  // ── init ─────────────────────────────────────────────────────────────────
  if (msg.type === 'init') {
    enc = new Mp3Encoder(msg.channels, msg.sampleRate, msg.bitrate)
    _channels = msg.channels
    _sampleRate = msg.sampleRate
    post({ type: 'ready' })
    return
  }

  // ── process (new path) ───────────────────────────────────────────────────
  // Decode raw compressed bytes → apply gain → encode to MP3, all in Worker thread.
  if (msg.type === 'process') {
    const { rawBuf, sampleOffset, gainConst, sectionGain, sectionStartSamp, sectionEndSamp } = msg

    // Decode: OfflineAudioContext is available in Web Workers
    let left: Float32Array
    let right: Float32Array | null = null
    try {
      const actx = new OfflineAudioContext(_channels, 1, _sampleRate)
      const decoded = await actx.decodeAudioData(rawBuf as ArrayBuffer)
      left = decoded.getChannelData(0)
      right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null
    } catch {
      post({ type: 'processed', dataBuf: new ArrayBuffer(0) }, [new ArrayBuffer(0)])
      return
    }

    // Apply gain + convert to Int16
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
    post({ type: 'processed', dataBuf: out.buffer }, [out.buffer])
    return
  }

  // ── encode (legacy path, Int16 input) ────────────────────────────────────
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
