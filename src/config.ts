export const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? 'https://recplay.nama1223.workers.dev'

export const R2_PUBLIC_URL = (import.meta.env.VITE_R2_PUBLIC_URL as string) ?? ''

export function buildR2PublicUrl(filename: string): string {
  const base = R2_PUBLIC_URL.replace(/\/$/, '')
  return base ? `${base}/${encodeURIComponent(filename)}` : ''
}
