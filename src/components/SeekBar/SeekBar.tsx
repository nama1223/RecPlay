import { useRef, useState, useCallback, useEffect } from 'react'
import { Section, AppMode } from '../../types'
import { SeekBarRow, LABEL_WIDTH, ROW_HEIGHT } from './SeekBarRow'

interface Props {
  currentTime: number
  duration: number
  secondsPerRow: number
  numRows: number
  sections: Section[]
  mode: AppMode
  waveformSamples: Float32Array | null
  activeSectionId: string | null
  onSeek: (time: number) => void
  onSectionUpdate: (id: string, updates: Partial<Section>) => void
  onSectionLabelClick?: (sectionId: string) => void
}

const MIN_SEEKBAR_H = 60
// Dynamic limits based on screen size (computed once at load)
const MAX_SEEKBAR_H = () => Math.round(window.innerHeight * 0.72)
const DEFAULT_SEEKBAR_H = () => Math.round(Math.min(320, window.innerHeight * 0.38))

interface DragState {
  sectionId: string
  isStart: boolean
}

export function SeekBar({
  currentTime,
  duration,
  secondsPerRow,
  numRows,
  sections,
  mode,
  waveformSamples,
  activeSectionId,
  onSeek,
  onSectionUpdate,
  onSectionLabelClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  const [seekbarHeight, setSeekbarHeight] = useState(DEFAULT_SEEKBAR_H)
  const resizeDrag = useRef<{ startY: number; startH: number } | null>(null)

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeDrag.current = { startY: e.clientY, startH: seekbarHeight }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizeDrag.current) return
    e.preventDefault()
    const dy = e.clientY - resizeDrag.current.startY
    setSeekbarHeight(Math.max(MIN_SEEKBAR_H, Math.min(MAX_SEEKBAR_H(), resizeDrag.current.startH + dy)))
  }
  const handleResizeEnd = () => { resizeDrag.current = null }

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !waveformSamples || duration <= 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const trackWidth = container.offsetWidth - LABEL_WIDTH
    const totalHeight = numRows * ROW_HEIGHT
    canvas.width = container.offsetWidth
    canvas.height = totalHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const totalBins = waveformSamples.length

    // binPx is fixed across all rows so the last (shorter) row doesn't stretch to fill full width
    const binsPerRow = (secondsPerRow / duration) * totalBins
    const binPx = trackWidth / binsPerRow

    for (let row = 0; row < numRows; row++) {
      const rowStartTime = row * secondsPerRow
      const rowEndTime = Math.min((row + 1) * secondsPerRow, duration)
      const rowY = row * ROW_HEIGHT

      const startBin = Math.floor((rowStartTime / duration) * totalBins)
      const endBin = Math.ceil((rowEndTime / duration) * totalBins)
      if (endBin <= startBin) continue

      for (let b = startBin; b < endBin; b++) {
        const amp = waveformSamples[b] ?? 0
        const barH = amp * (ROW_HEIGHT * 0.88)
        const x = LABEL_WIDTH + (b - startBin) * binPx
        ctx.fillStyle = `rgba(255,255,255,0.52)`
        ctx.fillRect(x, rowY + ROW_HEIGHT / 2 - barH / 2, Math.max(1, binPx - 0.5), barH)
      }
    }
  }, [waveformSamples, numRows, secondsPerRow, duration])

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
      return Math.max(0, Math.min(duration, clampedRow * secondsPerRow + xFraction * secondsPerRow))
    },
    [numRows, secondsPerRow, duration],
  )

  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.flag) return
    pointerDownPos.current = { x: e.clientX, y: e.clientY }
  }

  const handleContainerPointerUp = (e: React.PointerEvent) => {
    if (dragging) { setDragging(null); pointerDownPos.current = null; return }
    if (!pointerDownPos.current) return
    const dx = e.clientX - pointerDownPos.current.x
    const dy = e.clientY - pointerDownPos.current.y
    if (Math.sqrt(dx * dx + dy * dy) < 8) onSeek(getTimeFromPointer(e.clientX, e.clientY))
    pointerDownPos.current = null
  }

  // pointercancel fires when the browser takes over (e.g. pull-to-refresh, scroll).
  // Without this, dragging state stays set and the next touch acts as a phantom drag.
  const handleContainerPointerCancel = () => {
    setDragging(null)
    pointerDownPos.current = null
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const time = getTimeFromPointer(e.clientX, e.clientY)
    const section = sections.find((s) => s.id === dragging.sectionId)
    if (!section) return
    const MIN = 0.1
    if (dragging.isStart) {
      if (time >= section.endTime) {
        setDragging({ sectionId: dragging.sectionId, isStart: false })
        onSectionUpdate(dragging.sectionId, { startTime: section.endTime, endTime: Math.max(time, section.endTime + MIN) })
      } else {
        onSectionUpdate(dragging.sectionId, { startTime: time })
      }
    } else {
      if (time <= section.startTime) {
        setDragging({ sectionId: dragging.sectionId, isStart: true })
        onSectionUpdate(dragging.sectionId, { startTime: Math.min(time, section.startTime - MIN), endTime: section.startTime })
      } else {
        onSectionUpdate(dragging.sectionId, { endTime: time })
      }
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

  return (
    <div className="seekbar-wrapper">
      <div className="seekbar-scroll" style={{ height: seekbarHeight }}>
        <div
          ref={containerRef}
          className="seekbar-container"
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handleContainerPointerUp}
          onPointerCancel={handleContainerPointerCancel}
          style={{ touchAction: dragging ? 'none' : 'pan-y', position: 'relative' }}
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
              activeSectionId={activeSectionId}
              onFlagPointerDown={handleFlagPointerDown}
              onLabelClick={onSectionLabelClick}
            />
          ))}

          {/* Waveform canvas — placed last so it paints above rows */}
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: numRows * ROW_HEIGHT,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      <div className="seekbar-resize-handle">
        <button
          className="resize-extreme-btn"
          onClick={() => setSeekbarHeight(MIN_SEEKBAR_H)}
          title="シークバーを縮小"
        >▲</button>
        <div
          className="resize-drag-zone"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          title="ドラッグでサイズ変更"
        />
        <button
          className="resize-extreme-btn"
          onClick={() => setSeekbarHeight(MAX_SEEKBAR_H())}
          title="シークバーを拡大"
        >▼</button>
      </div>
    </div>
  )
}
