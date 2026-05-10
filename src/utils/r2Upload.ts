import { WORKER_URL } from '../config'

export interface UploadProgress {
  loaded: number
  total: number
  percent: number
}

/**
 * Upload a file directly to R2 via presigned URL.
 * Flow:
 *   1. POST /presign  → Worker returns { url, key }
 *   2. PUT {url}      → File body goes directly to R2 (no 100MB Worker limit)
 *
 * R2 CORS is configured via wrangler to allow PUT from the app's origin.
 */
export async function uploadToR2(
  file: File,
  onProgress?: (p: UploadProgress) => void,
  orgId?: string,
): Promise<string> {
  // Step 1: get presigned PUT URL from Worker
  const presignRes = await fetch(`${WORKER_URL}/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, orgId: orgId ?? 'default' }),
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}))
    throw new Error(`プリサインURL取得失敗 (${presignRes.status}): ${(err as any).error ?? ''}`)
  }
  const { url, key } = await presignRes.json() as { url: string; key: string }

  // Step 2: PUT directly to R2 (bypasses Cloudflare Workers 100MB limit)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
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
