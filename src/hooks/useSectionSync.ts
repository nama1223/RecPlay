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
 *
 * Safety guarantees:
 *  - Saves are blocked during the initial remote load to prevent overwriting
 *    R2 with an empty sections array (which was a data-loss bug when the user
 *    re-opened the same file from the file list).
 *  - A fileLoadCounter (incremented by the caller on every file selection,
 *    even the same file) forces a re-fetch so sections are always restored.
 *  - Comparison uses sections-only JSON so a just-loaded set is never written
 *    back unnecessarily.
 *
 * Modes:
 *  - edit: debounced save (1.5 s), force every FORCE_SYNC_EDITS changes
 *  - play: polls R2 every 10 s for remote updates
 */
export function useSectionSync(
  fileKey: string | null,
  fileLoadCounter: number,
  mode: 'play' | 'edit' | 'settings',
  sections: Section[],
  onRemoteUpdate: (sections: Section[]) => void,
): SyncStatus {
  // Stores sections-only JSON (no timestamp) to detect real changes
  const lastSavedJsonRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const editCountRef = useRef(0)

  /**
   * True while the initial remote fetch is in-flight.
   * Any save attempted during this window is silently dropped to prevent
   * an importSections([]) call from overwriting real R2 data with an empty array.
   */
  const isRemoteLoadingRef = useRef(false)

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

      // Safety guard: never save while the remote load is still in-flight
      if (isRemoteLoadingRef.current) return

      // Bail out if sections are identical to what was last saved/loaded
      const sectionsJson = JSON.stringify(secs)
      if (sectionsJson === lastSavedJsonRef.current) {
        setIsDirty(false)
        return
      }
      lastSavedJsonRef.current = sectionsJson

      const payload: SyncPayload = { sections: secs, updatedAt: new Date().toISOString() }
      try {
        await fetch(`${WORKER_URL}/sections?file=${encodeURIComponent(fileKey)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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

  // ── Load sections from R2 whenever file changes (or is re-selected) ─────
  useEffect(() => {
    if (!fileKey) return

    // Block saves until the load completes
    isRemoteLoadingRef.current = true
    lastSavedJsonRef.current = ''
    editCountRef.current = 0
    setIsDirty(false)

    fetchRemote().then((data) => {
      if (!mountedRef.current) return
      if (data?.sections?.length) {
        // Record what we loaded so the edit-save bail-out works correctly
        lastSavedJsonRef.current = JSON.stringify(data.sections)
        setLastSyncedAt(new Date())
        onRemoteUpdate(data.sections)
      }
      // Release the guard AFTER updating lastSavedJsonRef so the first
      // edit-save effect triggered by onRemoteUpdate bails out cleanly.
      isRemoteLoadingRef.current = false
    }).catch(() => {
      if (mountedRef.current) isRemoteLoadingRef.current = false
    })
  // fileLoadCounter ensures re-fetch even when the same fileKey is re-selected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, fileLoadCounter])

  // ── Edit mode: debounced save + force every N edits ──────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !fileKey) return

    // Do NOT save while the remote load is in-flight (prevents empty-section overwrite)
    if (isRemoteLoadingRef.current) return

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

  // ── Play mode: poll every 10 s ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'play' || !fileKey) return
    pollTimerRef.current = setInterval(async () => {
      const data = await fetchRemote()
      if (!mountedRef.current || !data?.sections?.length) return
      const sectionsJson = JSON.stringify(data.sections)
      if (sectionsJson !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = sectionsJson
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
