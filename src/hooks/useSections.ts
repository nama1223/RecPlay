import { useRef, useState, useCallback } from 'react'
import { Section, SECTION_COLORS } from '../types'

export function useSections() {
  const [sections, setSections] = useState<Section[]>([])
  const nextNumRef = useRef(1)

  const addSection = useCallback((startTime: number, endTime: number) => {
    const num = nextNumRef.current++
    setSections((prev) => {
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
  }, [])

  const updateSection = useCallback((id: string, updates: Partial<Section>) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }, [])

  const deleteSection = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const toggleExclude = useCallback((id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isExcluded: !s.isExcluded } : s)),
    )
  }, [])

  const importSections = useCallback((data: Section[]) => {
    setSections(data)
    nextNumRef.current = data.length + 1
  }, [])

  const reorderSections = useCallback((newOrder: Section[]) => {
    setSections(newOrder)
  }, [])

  return { sections, setSections, addSection, updateSection, deleteSection, toggleExclude, importSections, reorderSections }
}
