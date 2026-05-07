export const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? 'https://recplay.nama1223.workers.dev'

export const R2_PUBLIC_URL = (import.meta.env.VITE_R2_PUBLIC_URL as string) ?? ''

export function buildR2PublicUrl(key: string): string {
  const base = R2_PUBLIC_URL.replace(/\/$/, '')
  if (!base) return ''
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${encoded}`
}

/** Workerの /audio エンドポイント経由で音声を再生するURL */
export function buildWorkerAudioUrl(key: string): string {
  return `${WORKER_URL}/audio?key=${encodeURIComponent(key)}`
}

/** アプリ内でファイルを開く共有URL（?url=...形式） */
export function buildAppShareUrl(key: string): string {
  const audioUrl = buildWorkerAudioUrl(key)
  const origin = window.location.origin
  const path = window.location.pathname.replace(/\/?$/, '/')
  return `${origin}${path}?url=${encodeURIComponent(audioUrl)}`
}
