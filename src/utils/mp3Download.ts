import { Section } from '../types'

async function fetchByteRange(url: string, startByte: number, endByte: number): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${startByte}-${endByte}` },
  })
  if (!res.ok && res.status !== 206) throw new Error(`fetch failed: ${res.status}`)
  return res.arrayBuffer()
}

async function getFileSize(url: string): Promise<number> {
  const res = await fetch(url, { method: 'HEAD' })
  const len = res.headers.get('Content-Length')
  if (!len) throw new Error('Content-Length header missing')
  return parseInt(len, 10)
}

function timeToByte(time: number, duration: number, fileSize: number): number {
  return Math.round((time / duration) * fileSize)
}

function triggerDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function downloadClip(
  audioUrl: string,
  startTime: number,
  endTime: number,
  duration: number,
  filename: string,
): Promise<void> {
  const fileSize = await getFileSize(audioUrl)
  const startByte = timeToByte(startTime, duration, fileSize)
  const endByte = timeToByte(endTime, duration, fileSize)
  const buffer = await fetchByteRange(audioUrl, startByte, endByte - 1)
  triggerDownload(buffer, filename)
}

export async function downloadWithExcludes(
  audioUrl: string,
  sections: Section[],
  duration: number,
  filename: string,
): Promise<void> {
  const fileSize = await getFileSize(audioUrl)

  const excluded = sections
    .filter((s) => s.isExcluded)
    .sort((a, b) => a.startTime - b.startTime)

  // Build non-excluded segments
  const segments: { start: number; end: number }[] = []
  let cursor = 0
  for (const zone of excluded) {
    if (zone.startTime > cursor) segments.push({ start: cursor, end: zone.startTime })
    cursor = Math.max(cursor, zone.endTime)
  }
  if (cursor < duration) segments.push({ start: cursor, end: duration })

  if (segments.length === 0) throw new Error('全体が除外されています')

  const buffers = await Promise.all(
    segments.map((seg) => {
      const s = timeToByte(seg.start, duration, fileSize)
      const e = timeToByte(seg.end, duration, fileSize)
      return fetchByteRange(audioUrl, s, e - 1)
    }),
  )

  // Concatenate ArrayBuffers
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }

  triggerDownload(merged.buffer, filename)
}
