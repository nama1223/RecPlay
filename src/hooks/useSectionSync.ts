import { useCallback, useEffect, useRef, useState } from 'react'
import { Section } from '../types'
import { WORKER_URL } from '../config'

const POLL_INTERVAL = 10_000
const DEBOUNCE_MS = 1_500
const FORCE_SYNC_EDITS = 5

interface SyncPayload {
  sections: Section[]
  updatedAt: string
}

export interface SyncStatus {
  lastSyncedAt: Date | null
  isDirty: boolean
}

/**
 * Syncs sections with R2 via Worker.
 * - edit mode: debounced save (1.5s), force save every FORCE_SYNC_EDITS changes
 * - play mode: polls R2 every 10s
 * Returns SyncStatus for display.
 */
export function useSectionSync(
  fileKey: string | null,
  mode: 'play' | 'edit' | 'settings',
  sections: Section[],
  onRemoteUpdate: (sections: Section[]) => void,
): SyncStatus {
  const lastSavedRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const editCountRef = useRef(0)

  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [isDirty, setIsDirty] = useState(false)

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
      if (body === lastSavedRef.current) { setIsDirty(false); return }
      lastSavedRef.current = body
      try {
        await fetch(`${WORKER_URL}/sections?file=${encodeURIComponent(fileKey)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        if (mountedRef.current) {
          setLastSyncedAt(new Date())
          setIsDirty(false)
        }
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
        setLastSyncedAt(new Date())
        onRemoteUpdate(data.sections)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey])

  // ── Edit mode: debounced save + force every N edits ──────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !fileKey) return

    setIsDirty(true)
    editCountRef.current += 1

    // Force immediate save every N edits
    if (editCountRef.current >= FORCE_SYNC_EDITS) {
      editCountRef.current = 0
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveRemote(sections)
      return
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveRemote(sections), DEBOUNCE_MS)
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

  return { lastSyncedAt, isDirty }
}
