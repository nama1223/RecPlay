/// <reference lib="webworker" />
/**
 * Web Worker: MP3 encoding via lamejs.
 * Runs on a separate thread so encoding never blocks the main UI.
 *
 * Protocol (all messages are request/response pairs):
 *   init   { type:'init',   channels, sampleRate, bitrate }
 *          → { type:'ready' }
 *   encode { type:'encode', leftBuf: ArrayBuffer, rightBuf: ArrayBuffer|null }
 *          → { type:'encoded', dataBuf: ArrayBuffer }   (transferred, zero-copy)
 *   flush  { type:'flush' }
 *          → { type:'flushed', dataBuf: ArrayBuffer }   (transferred)
 */

import { Mp3Encoder } from '@breezystack/lamejs'

const FRAME = 1152  // MP3 samples per frame
let enc: InstanceType<typeof Mp3Encoder> | null = null

const post = (msg: object, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer)

self.onmessage = ({ data: msg }: MessageEvent) => {
  if (msg.type === 'init') {
    enc = new Mp3Encoder(msg.channels, msg.sampleRate, msg.bitrate)
    post({ type: 'ready' })
    return
  }

  if (msg.type === 'encode') {
    const left  = new Int16Array(msg.leftBuf)
    const right = msg.rightBuf != null ? new Int16Array(msg.rightBuf) : null
    const parts: Int8Array[] = []
    if (enc) {
      for (let i = 0; i < left.length; i += FRAME) {
        const l = left.subarray(i, i + FRAME)
        const r = right?.subarray(i, i + FRAME)
        const buf = r ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l)
        if (buf.length > 0) parts.push(buf)
      }
    }
    const total = parts.reduce((s, p) => s + p.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const p of parts) { out.set(p, off); off += p.length }
    post({ type: 'encoded', dataBuf: out.buffer }, [out.buffer])
    return
  }

  if (msg.type === 'flush') {
    const tail = enc ? enc.flush() : new Int8Array(0)
    enc = null
    const out = new Uint8Array(tail.length)
    out.set(tail)
    post({ type: 'flushed', dataBuf: out.buffer }, [out.buffer])
  }
}
