import { useRef, useState, useCallback, useEffect } from 'react'
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
  waveformSamples: Float32Array | null
  onSeek: (time: number) => void
  onSectionUpdate: (id: string, updates: Partial<Section>) => void
  onZoomIn: () => void
  onZoomOut: () => void
}

const MIN_SEEKBAR_H = 60
const MAX_SEEKBAR_H = 800
const DEFAULT_SEEKBAR_H = 200

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
  waveformSamples,
  onSeek,
  onSectionUpdate,
  onZoomIn,
  onZoomOut,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  const [seekbarHeight, setSeekbarHeight] = useState(DEFAULT_SEEKBAR_H)
  const resizeDrag = useRef<{ startY: number; startH: number } | null>(null)

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    resizeDrag.current = { startY: e.clientY, startH: seekbarHeight }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizeDrag.current) return
    const dy = e.clientY - resizeDrag.current.startY
    setSeekbarHeight(Math.max(MIN_SEEKBAR_H, Math.min(MAX_SEEKBAR_H, resizeDrag.current.startH + dy)))
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

    for (let row = 0; row < numRows; row++) {
      const rowStartTime = row * secondsPerRow
      const rowEndTime = Math.min((row + 1) * secondsPerRow, duration)
      const rowY = row * ROW_HEIGHT

      const startBin = Math.floor((rowStartTime / duration) * totalBins)
      const endBin = Math.ceil((rowEndTime / duration) * totalBins)
      const numBins = endBin - startBin
      if (numBins <= 0) continue

      const binPx = trackWidth / numBins

      for (let b = startBin; b < endBin; b++) {
        const amp = waveformSamples[b] ?? 0
        const barH = amp * (ROW_HEIGHT * 0.75)
        const x = LABEL_WIDTH + (b - startBin) * binPx
        ctx.fillStyle = `rgba(120,180,255,0.25)`
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

  const zoomLabel = (spr: number) => (spr >= 60 ? `${spr / 60}分/段` : `${spr}秒/段`)

  return (
    <div className="seekbar-wrapper">
      <div className="zoom-controls">
        {/* − on left, ＋ on right */}
        <button className="zoom-btn" onClick={onZoomOut} disabled={zoomIndex === ZOOM_LEVELS.length - 1} title="ズームアウト">−</button>
        <span className="zoom-label">{zoomLabel(secondsPerRow)}</span>
        <button className="zoom-btn" onClick={onZoomIn} disabled={zoomIndex === 0} title="ズームイン">＋</button>
      </div>

      <div className="seekbar-scroll" style={{ height: seekbarHeight }}>
        <div
          ref={containerRef}
          className="seekbar-container"
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handleContainerPointerUp}
          style={{ touchAction: dragging ? 'none' : 'pan-y', position: 'relative' }}
        >
          {/* Waveform canvas overlay */}
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: numRows * ROW_HEIGHT,
              pointerEvents: 'none', zIndex: 1,
            }}
          />

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

      <div
        className="seekbar-resize-handle"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        title="ドラッグでサイズ変更"
      />
    </div>
  )
}
