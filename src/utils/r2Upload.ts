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
  const safeName = file.name.replace(/[/\\#%?&=+<>"'\x00-\x1f]/g, '_')
  const key = orgId ? `${orgId}/${timestamp}_${safeName}` : `${timestamp}_${safeName}`

  const uploadUrl = `${WORKER_URL}/upload?key=${encodeURIComponent(key)}`

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
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
    xhr.send(file)
  })

  return key
}
