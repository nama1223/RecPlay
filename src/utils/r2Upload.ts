import { WORKER_URL } from '../config'

export interface UploadProgress {
  loaded: number
  total: number
  percent: number
}

/**
 * Upload a file to R2 via Worker proxy.
 * Flow:
 *   1. POST /presign → Worker returns { key } (key = org/timestamp_filename)
 *   2. PUT /upload?key={key} → Worker streams file body to R2 via native binding
 *
 * Note: Previously used presigned R2 URLs for direct upload, but R2's
 * r2.cloudflarestorage.com endpoint requires bucket-level CORS configuration.
 * Routing through the Worker avoids that requirement (Worker already has CORS headers).
 */
export async function uploadToR2(
  file: File,
  onProgress?: (p: UploadProgress) => void,
  orgId?: string,
): Promise<string> {
  // Step 1: get a key from Worker (orgId prefix + timestamp + safe filename)
  const presignRes = await fetch(`${WORKER_URL}/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, orgId: orgId ?? 'default' }),
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}))
    throw new Error(`キー取得失敗 (${presignRes.status}): ${(err as any).error ?? ''}`)
  }
  const { key } = await presignRes.json() as { url: string; key: string }

  // Step 2: PUT through Worker (CORS handled by Worker, streams to R2 native binding)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${WORKER_URL}/upload?key=${encodeURIComponent(key)}`)
    xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        })
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`アップロード失敗 (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('ネットワークエラー'))
    xhr.ontimeout = () => reject(new Error('タイムアウト'))
    xhr.send(file)
  })

  return key
}
