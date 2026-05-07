import { WORKER_URL } from '../config'

export interface UploadProgress {
  loaded: number
  total: number
  percent: number
}

export async function uploadToR2(
  file: File,
  onProgress?: (p: UploadProgress) => void,
  orgId?: string,
): Promise<string> {
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^\w.\-]/g, '_')
  const key = orgId ? `${orgId}/${timestamp}_${safeName}` : `${timestamp}_${safeName}`

  // Worker から署名付きアップロードURLを取得
  const res = await fetch(`${WORKER_URL}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: key }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`署名付きURL取得失敗 (${res.status}): ${text}`)
  }

  const { url } = (await res.json()) as { url: string }

  // XHR でアップロード（進捗取得のため）
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', 'audio/mpeg')

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
    xhr.send(file)
  })

  return key
}
