export const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? 'https://recplay.nama1223.workers.dev'

export const R2_PUBLIC_URL = (import.meta.env.VITE_R2_PUBLIC_URL as string) ?? ''

export function buildR2PublicUrl(key: string): string {
  const base = R2_PUBLIC_URL.replace(/\/$/, '')
  if (!base) return ''
  // キーの / はパス区切りなので各セグメントだけエンコード
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${encoded}`
}

/** アプリ内でファイルを開く共有URL（?url=...形式） */
export function buildAppShareUrl(r2FileKey: string): string {
  const r2Url = buildR2PublicUrl(r2FileKey)
  if (!r2Url) return ''
  const origin = window.location.origin
  const path = window.location.pathname.replace(/\/?$/, '/')
  return `${origin}${path}?url=${encodeURIComponent(r2Url)}`
}
