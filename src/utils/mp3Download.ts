import { Section } from '../types'

// Mobile browsers (and some desktop ones) truncate response.arrayBuffer() for
// very large single requests. Fetch in chunks to stay within safe limits.
// 8 MB ≈ 8 minutes of 128 kbps audio — well within any browser's limits.
const FETCH_CHUNK_BYTES = 8 * 1024 * 1024

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

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * Fetch [startByte, endByte] in FETCH_CHUNK_BYTES-sized pieces and stream into a Blob.
 * Avoids loading the entire range into memory at once (mobile browser limit).
 */
async function fetchRangeChunked(url: string, startByte: number, endByte: number): Promise<Blob> {
  const parts: ArrayBuffer[] = []
  let pos = startByte
  while (pos <= endByte) {
    const chunkEnd = Math.min(pos + FETCH_CHUNK_BYTES - 1, endByte)
    parts.push(await fetchByteRange(url, pos, chunkEnd))
    pos = chunkEnd + 1
  }
  return new Blob(parts, { type: 'audio/mpeg' })
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
  const endByte   = timeToByte(endTime,   duration, fileSize) - 1
  const blob = await fetchRangeChunked(audioUrl, startByte, endByte)
  triggerDownload(blob, filename)
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

  // Build list of [startByte, endByte] segments to include (everything except excluded zones)
  const segments: { startByte: number; endByte: number }[] = []

  if (excluded.length === 0) {
    segments.push({ startByte: 0, endByte: fileSize - 1 })
  } else {
    let cursor = 0  // in seconds
    for (const zone of excluded) {
      if (zone.startTime > cursor) {
        segments.push({
          startByte: timeToByte(cursor,          duration, fileSize),
          endByte:   timeToByte(zone.startTime,  duration, fileSize) - 1,
        })
      }
      cursor = Math.max(cursor, zone.endTime)
    }
    if (cursor < duration) {
      segments.push({
        startByte: timeToByte(cursor, duration, fileSize),
        endByte:   fileSize - 1,
      })
    }
  }

  // Filter out zero-length or inverted ranges (can happen at exact boundaries)
  const validSegments = segments.filter((s) => s.startByte >= 0 && s.startByte <= s.endByte)
  if (validSegments.length === 0) throw new Error('全体が除外されています')

  // Fetch each segment in small chunks → collect as Blob parts (avoids large ArrayBuffer in memory)
  const blobParts: Blob[] = []
  for (const seg of validSegments) {
    blobParts.push(await fetchRangeChunked(audioUrl, seg.startByte, seg.endByte))
  }

  triggerDownload(new Blob(blobParts, { type: 'audio/mpeg' }), filename)
}
