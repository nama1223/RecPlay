import { Section } from '../types'

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
 * Stream the full audio file chunk by chunk.
 * Returns accumulated chunks and total byte count.
 * Does NOT rely on Content-Length (Worker audio URLs may return wrong values).
 */
async function streamFull(url: string): Promise<{ chunks: Uint8Array[]; totalBytes: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ファイルの取得に失敗しました (${res.status})`)

  if (!res.body) {
    // Fallback for environments without ReadableStream
    const buf = await res.arrayBuffer()
    return { chunks: [new Uint8Array(buf)], totalBytes: buf.byteLength }
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) { chunks.push(value); totalBytes += value.length }
  }
  return { chunks, totalBytes }
}

/**
 * Extract byte range [startByte, endByte) from an array of sequential chunks.
 */
function sliceChunks(
  chunks: Uint8Array[],
  startByte: number,
  endByte: number,  // exclusive
): BlobPart[] {
  const parts: BlobPart[] = []
  let bytePos = 0
  for (const chunk of chunks) {
    const chunkEnd = bytePos + chunk.length
    if (chunkEnd > startByte && bytePos < endByte) {
      const s = Math.max(0, startByte - bytePos)
      const e = Math.min(chunk.length, endByte - bytePos)
      parts.push(chunk.slice(s, e))
    }
    bytePos = chunkEnd
    if (bytePos >= endByte) break
  }
  return parts
}

/**
 * Download a single clip (start–end) from the audio file.
 * Streams the full file to get the actual byte count, then extracts the clip range.
 */
export async function downloadClip(
  audioUrl: string,
  startTime: number,
  endTime: number,
  duration: number,
  filename: string,
): Promise<void> {
  const { chunks, totalBytes } = await streamFull(audioUrl)
  const startByte = Math.round((startTime / duration) * totalBytes)
  const endByte   = Math.round((endTime   / duration) * totalBytes)
  const parts = sliceChunks(chunks, startByte, endByte)
  triggerDownload(new Blob(parts, { type: 'audio/mpeg' }), filename)
}

/**
 * Download the full audio file minus any excluded sections.
 * Streams the full file so that the actual byte count drives all calculations —
 * Worker audio URLs sometimes return wrong Content-Length in HEAD responses.
 */
export async function downloadWithExcludes(
  audioUrl: string,
  sections: Section[],
  duration: number,
  filename: string,
): Promise<void> {
  const { chunks, totalBytes } = await streamFull(audioUrl)

  const excluded = sections
    .filter((s) => s.isExcluded)
    .sort((a, b) => a.startTime - b.startTime)

  if (excluded.length === 0) {
    // No exclusions — hand all raw chunks straight to the browser
    triggerDownload(new Blob(chunks, { type: 'audio/mpeg' }), filename)
    return
  }

  // Build excluded byte ranges from actual stream size (not from Content-Length)
  const exclRanges = excluded.map((zone) => ({
    start: Math.round((zone.startTime / duration) * totalBytes),   // inclusive
    end:   Math.round((zone.endTime   / duration) * totalBytes),   // exclusive
  }))

  // Walk chunks and collect non-excluded bytes
  const blobParts: BlobPart[] = []
  let bytePos = 0

  for (const chunk of chunks) {
    const chunkStart = bytePos
    let pos = 0  // read offset within this chunk

    for (const ex of exclRanges) {
      // Offset of this excluded range inside the current chunk
      const exStartLocal = ex.start - chunkStart
      const exEndLocal   = ex.end   - chunkStart

      // Include bytes from current pos up to the start of the excluded zone
      const includeEnd = Math.min(Math.max(exStartLocal, pos), chunk.length)
      if (pos < includeEnd) {
        blobParts.push(chunk.slice(pos, includeEnd))
      }
      // Advance past the excluded zone (but not beyond the chunk)
      pos = Math.max(pos, Math.min(Math.max(exEndLocal, 0), chunk.length))
    }

    // Include any remaining bytes after all excluded zones
    if (pos < chunk.length) {
      blobParts.push(chunk.slice(pos))
    }

    bytePos += chunk.length
  }

  if (blobParts.length === 0) throw new Error('全体が除外されています')
  triggerDownload(new Blob(blobParts, { type: 'audio/mpeg' }), filename)
}
