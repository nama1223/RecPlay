import { useState, useCallback } from 'react'
import { Section, SECTION_COLORS } from '../types'

export function useSections() {
  const [sections, setSections] = useState<Section[]>([])

  const addSection = useCallback(
    (startTime: number, endTime: number, label = '新しい区間') => {
      setSections((prev) => {
        const newSection: Section = {
          id: crypto.randomUUID(),
          label,
          startTime,
          endTime,
          isExcluded: false,
          color: SECTION_COLORS[prev.length % SECTION_COLORS.length],
        }
        return [...prev, newSection].sort((a, b) => a.startTime - b.startTime)
      })
    },
    [],
  )

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
  }, [])

  return { sections, setSections, addSection, updateSection, deleteSection, toggleExclude, importSections }
}
