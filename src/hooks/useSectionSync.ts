import { useCallback, useEffect, useRef } from 'react'
import { Section } from '../types'
import { WORKER_URL } from '../config'

const POLL_INTERVAL = 10_000

interface SyncPayload {
  sections: Section[]
  updatedAt: string
}

/**
 * Syncs sections with R2 via Worker.
 * - In 'edit' mode: saves sections to R2 on change (debounced 2s)
 * - In 'play' mode: polls R2 every 10s and calls onRemoteUpdate when changed
 */
export function useSectionSync(
  fileKey: string | null,
  mode: 'play' | 'edit' | 'settings',
  sections: Section[],
  onRemoteUpdate: (sections: Section[]) => void,
) {
  const lastSavedRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  // ── Fetch from Worker ────────────────────────────────────────────────────
  const fetchRemote = useCallback(async (): Promise<SyncPayload | null> => {
    if (!fileKey) return null
    try {
      const res = await fetch(`${WORKER_URL}/sections?file=${encodeURIComponent(fileKey)}`)
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }, [fileKey])

  // ── Save to Worker ───────────────────────────────────────────────────────
  const saveRemote = useCallback(
    async (secs: Section[]) => {
      if (!fileKey) return
      const payload: SyncPayload = { sections: secs, updatedAt: new Date().toISOString() }
      const body = JSON.stringify(payload)
      if (body === lastSavedRef.current) return
      lastSavedRef.current = body
      try {
        await fetch(`${WORKER_URL}/sections?file=${encodeURIComponent(fileKey)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      } catch {
        // silent – best-effort sync
      }
    },
    [fileKey],
  )

  // ── On mount: load initial sections from R2 ──────────────────────────────
  useEffect(() => {
    if (!fileKey) return
    fetchRemote().then((data) => {
      if (!mountedRef.current) return
      if (data?.sections?.length) {
        lastSavedRef.current = JSON.stringify(data)
        onRemoteUpdate(data.sections)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey])

  // ── Edit mode: debounced save on sections change ─────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !fileKey) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveRemote(sections), 2000)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [sections, mode, fileKey, saveRemote])

  // ── Play mode: poll every 10s ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'play' || !fileKey) return
    pollTimerRef.current = setInterval(async () => {
      const data = await fetchRemote()
      if (!mountedRef.current || !data?.sections?.length) return
      const body = JSON.stringify(data)
      if (body !== lastSavedRef.current) {
        lastSavedRef.current = body
        onRemoteUpdate(data.sections)
      }
    }, POLL_INTERVAL)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [mode, fileKey, fetchRemote, onRemoteUpdate])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
}
