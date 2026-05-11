import { Section } from '../types'

async function fetchByteRange(url: string, startByte: number, endByte: number): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${startByte}-${endByte}` },
  })
  if (!res.ok && res.status !== 206) throw new Error(`fetch failed: ${res.status}`)
  return res.arrayBuffer()
}

async function getFileSize(url: string): Promise<number> {
  // Try HEAD + Content-Length first
  const head = await fetch(url, { method: 'HEAD' })
  const cl = parseInt(head.headers.get('Content-Length') ?? '0')
  if (cl > 0) return cl
  // Fallback: Range: bytes=0-0 → read total from Content-Range
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' } })
  const cr = r.headers.get('Content-Range')
  const total = cr ? parseInt(cr.split('/')[1] ?? '0') : 0
  if (total > 0) return total
  throw new Error('ファイルサイズを取得できません')
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
  if (fileSize <= 0) throw new Error(`ファイルサイズが取得できませんでした (${fileSize})`)

  const excluded = sections
    .filter((s) => s.isExcluded)
    .sort((a, b) => a.startTime - b.startTime)

  // Build list of byte ranges to download (everything except excluded zones)
  const byteRanges: { startByte: number; endByte: number }[] = []

  if (excluded.length === 0) {
    // No excluded zones — download the whole file
    byteRanges.push({ startByte: 0, endByte: fileSize - 1 })
  } else {
    let cursor = 0
    for (const zone of excluded) {
      if (zone.startTime > cursor) {
        byteRanges.push({
          startByte: timeToByte(cursor, duration, fileSize),
          endByte: timeToByte(zone.startTime, duration, fileSize) - 1,
        })
      }
      cursor = Math.max(cursor, zone.endTime)
    }
    if (cursor < duration) {
      byteRanges.push({
        startByte: timeToByte(cursor, duration, fileSize),
        endByte: fileSize - 1,
      })
    }
  }

  // Filter out zero-length or invalid ranges
  const validRanges = byteRanges.filter((r) => r.startByte <= r.endByte && r.startByte >= 0)
  if (validRanges.length === 0) throw new Error('全体が除外されています')

  const buffers = await Promise.all(
    validRanges.map((r) => fetchByteRange(audioUrl, r.startByte, r.endByte)),
  )

  // Concatenate and trigger download
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }

  triggerDownload(merged.buffer, filename)
}
