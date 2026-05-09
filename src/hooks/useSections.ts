import { useRef, useState, useCallback } from 'react'
import { Section, SECTION_COLORS } from '../types'

const MAX_HISTORY = 50

export function useSections() {
  const [sections, setSections] = useState<Section[]>([])
  const nextNumRef = useRef(1)

  // ── History refs ────────────────────────────────────────────────────────
  const sectionsRef = useRef<Section[]>([])   // mirror of state (always current)
  const pastRef     = useRef<Section[][]>([]) // undo stack
  const futureRef   = useRef<Section[][]>([]) // redo stack
  const pendingRef  = useRef(false)           // true while debounce timer is running
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  // setSections that also keeps sectionsRef in sync
  const setSync = useCallback((updater: ((prev: Section[]) => Section[]) | Section[]) => {
    setSections((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      sectionsRef.current = next
      return next
    })
  }, [])

  // Immediate history push (for add / delete / toggleExclude / reorder)
  const pushHistory = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingRef.current = false
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), [...sectionsRef.current]]
    futureRef.current = []
    setUndoCount(pastRef.current.length)
    setRedoCount(0)
  }, [])

  // Debounced capture (for continuous edits like seekbar dragging or label typing).
  // Captures the state BEFORE the first change in a burst, then resets after 800ms of silence.
  const ensureHistory = useCallback(() => {
    if (!pendingRef.current) {
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), [...sectionsRef.current]]
      futureRef.current = []
      pendingRef.current = true
      setUndoCount(pastRef.current.length)
      setRedoCount(0)
    }
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = setTimeout(() => { pendingRef.current = false }, 800)
  }, [])

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingRef.current = false }
    const restored = pastRef.current[pastRef.current.length - 1]
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [[...sectionsRef.current], ...futureRef.current.slice(0, MAX_HISTORY - 1)]
    sectionsRef.current = restored
    setSections(restored)
    setUndoCount(pastRef.current.length)
    setRedoCount(futureRef.current.length)
  }, [])

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    const [next, ...rest] = futureRef.current
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), [...sectionsRef.current]]
    futureRef.current = rest
    sectionsRef.current = next
    setSections(next)
    setUndoCount(pastRef.current.length)
    setRedoCount(rest.length)
  }, [])

  // ── Mutations ────────────────────────────────────────────────────────────
  const addSection = useCallback((startTime: number, endTime: number) => {
    pushHistory()
    const num = nextNumRef.current++
    setSync((prev) => {
      const newSection: Section = {
        id: crypto.randomUUID(),
        label: `区間 ${num}`,
        startTime,
        endTime,
        isExcluded: false,
        color: SECTION_COLORS[prev.length % SECTION_COLORS.length],
      }
      return [...prev, newSection]
    })
  }, [pushHistory, setSync])

  // updateSection uses debounced history (seekbar drag fires many times per second)
  const updateSection = useCallback((id: string, updates: Partial<Section>) => {
    ensureHistory()
    setSync((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }, [ensureHistory, setSync])

  const deleteSection = useCallback((id: string) => {
    pushHistory()
    setSync((prev) => prev.filter((s) => s.id !== id))
  }, [pushHistory, setSync])

  const toggleExclude = useCallback((id: string) => {
    pushHistory()
    setSync((prev) => prev.map((s) => (s.id === id ? { ...s, isExcluded: !s.isExcluded } : s)))
  }, [pushHistory, setSync])

  const importSections = useCallback((data: Section[]) => {
    sectionsRef.current = data
    setSections(data)
    nextNumRef.current = data.length + 1
    // Clear history on bulk import
    pastRef.current = []
    futureRef.current = []
    setUndoCount(0)
    setRedoCount(0)
  }, [])

  const reorderSections = useCallback((newOrder: Section[]) => {
    pushHistory()
    setSync(newOrder)
  }, [pushHistory, setSync])

  return {
    sections, setSections,
    addSection, updateSection, deleteSection, toggleExclude, importSections, reorderSections,
    undo, redo, undoCount, redoCount,
  }
}
