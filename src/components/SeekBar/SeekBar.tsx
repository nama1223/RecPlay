import { useRef, useState, useCallback } from 'react'
import { Section, AppMode, ZOOM_LEVELS } from '../../types'
import { SeekBarRow, LABEL_WIDTH, ROW_HEIGHT } from './SeekBarRow'

interface Props {
  currentTime: number
  duration: number
  secondsPerRow: number
  numRows: number
  zoomIndex: number
  sections: Section[]
  mode: AppMode
  onSeek: (time: number) => void
  onSectionUpdate: (id: string, updates: Partial<Section>) => void
  onZoomIn: () => void
  onZoomOut: () => void
}

interface DragState {
  sectionId: string
  isStart: boolean
}

export function SeekBar({
  currentTime,
  duration,
  secondsPerRow,
  numRows,
  zoomIndex,
  sections,
  mode,
  onSeek,
  onSectionUpdate,
  onZoomIn,
  onZoomOut,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  const getTimeFromPointer = useCallback(
    (clientX: number, clientY: number): number => {
      if (!containerRef.current) return 0
      const rect = containerRef.current.getBoundingClientRect()
      const relY = clientY - rect.top
      const relX = clientX - rect.left - LABEL_WIDTH

      const rowIndex = Math.floor(relY / ROW_HEIGHT)
      const clampedRow = Math.max(0, Math.min(numRows - 1, rowIndex))
      const trackWidth = rect.width - LABEL_WIDTH
      const xFraction = trackWidth > 0 ? Math.max(0, Math.min(1, relX / trackWidth)) : 0

      const time = clampedRow * secondsPerRow + xFraction * secondsPerRow
      return Math.max(0, Math.min(duration, time))
    },
    [numRows, secondsPerRow, duration],
  )

  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.flag) return
    pointerDownPos.current = { x: e.clientX, y: e.clientY }
  }

  const handleContainerPointerUp = (e: React.PointerEvent) => {
    if (dragging) {
      setDragging(null)
      pointerDownPos.current = null
      return
    }
    if (!pointerDownPos.current) return
    const dx = e.clientX - pointerDownPos.current.x
    const dy = e.clientY - pointerDownPos.current.y
    if (Math.sqrt(dx * dx + dy * dy) < 8) {
      onSeek(getTimeFromPointer(e.clientX, e.clientY))
    }
    pointerDownPos.current = null
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const time = getTimeFromPointer(e.clientX, e.clientY)
    const section = sections.find((s) => s.id === dragging.sectionId)
    if (!section) return

    if (dragging.isStart) {
      onSectionUpdate(dragging.sectionId, {
        startTime: Math.min(time, section.endTime - 0.5),
      })
    } else {
      onSectionUpdate(dragging.sectionId, {
        endTime: Math.max(time, section.startTime + 0.5),
      })
    }
  }

  const handleFlagPointerDown = useCallback(
    (e: React.PointerEvent, sectionId: string, isStart: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDragging({ sectionId, isStart })
      pointerDownPos.current = null
    },
    [],
  )

  const zoomLabel = (spr: number) =>
    spr >= 60 ? `${spr / 60}分/段` : `${spr}秒/段`

  return (
    <div className="seekbar-wrapper">
      <div className="zoom-controls">
        <button
          className="zoom-btn"
          onClick={onZoomIn}
          disabled={zoomIndex === 0}
          title="ズームイン（短く）"
        >
          ＋
        </button>
        <span className="zoom-label">{zoomLabel(secondsPerRow)}</span>
        <button
          className="zoom-btn"
          onClick={onZoomOut}
          disabled={zoomIndex === ZOOM_LEVELS.length - 1}
          title="ズームアウト（長く）"
        >
          −
        </button>
      </div>

      <div className="seekbar-scroll">
        <div
          ref={containerRef}
          className="seekbar-container"
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handleContainerPointerUp}
          style={{ touchAction: dragging ? 'none' : 'pan-y' }}
        >
          {Array.from({ length: numRows }, (_, i) => (
            <SeekBarRow
              key={i}
              rowIndex={i}
              secondsPerRow={secondsPerRow}
              duration={duration}
              currentTime={currentTime}
              sections={sections}
              mode={mode}
              activeDragId={dragging?.sectionId ?? null}
              onFlagPointerDown={handleFlagPointerDown}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
