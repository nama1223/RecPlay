import { Section, AppMode } from '../../types'
import { formatTime } from '../../utils/timeFormat'

export const LABEL_WIDTH = 42
export const ROW_HEIGHT = 36

interface Props {
  rowIndex: number
  secondsPerRow: number
  duration: number
  currentTime: number
  sections: Section[]
  mode: AppMode
  activeDragId: string | null
  activeSectionId: string | null
  onFlagPointerDown: (e: React.PointerEvent, sectionId: string, isStart: boolean) => void
  onLabelClick?: (sectionId: string) => void
}

export function SeekBarRow({
  rowIndex,
  secondsPerRow,
  duration,
  currentTime,
  sections,
  mode,
  activeDragId,
  activeSectionId,
  onFlagPointerDown,
  onLabelClick,
}: Props) {
  const rowStart = rowIndex * secondsPerRow
  const rowEnd = Math.min((rowIndex + 1) * secondsPerRow, duration)

  const xPct = (t: number) => {
    const clamped = Math.max(rowStart, Math.min(rowEnd, t))
    return ((clamped - rowStart) / secondsPerRow) * 100
  }

  const inRow = (t: number) => t >= rowStart && t <= rowEnd

  const showPlayhead = currentTime >= rowStart && currentTime < rowEnd
  const playheadPct = xPct(currentTime)

  return (
    <div className="seekbar-row" style={{ height: ROW_HEIGHT }}>
      <div className="row-label" style={{ width: LABEL_WIDTH }}>
        {formatTime(rowStart)}
      </div>

      <div className="row-track">
        {/* Section overlays + labels */}
        {sections.map((section) => {
          if (section.startTime >= rowEnd || section.endTime <= rowStart) return null
          const left = xPct(section.startTime)
          const right = 100 - xPct(section.endTime)
          const isExcluded = section.isExcluded
          const isPlayMode = mode === 'play'

          // Label is shown only on the first row of this section
          const isFirstRow = section.startTime >= rowStart && section.startTime < rowEnd
          const labelLeft = Math.max(left, 0)

          // Excluded zone in play mode: same diagonal stripe as edit mode, 90% height, no label
          if (isPlayMode && isExcluded) {
            return (
              <div key={section.id}>
                <div
                  className="section-overlay excluded"
                  style={{
                    left: `${left}%`,
                    right: `${right}%`,
                    top: '5%',
                    bottom: '5%',
                    background: 'rgba(80,80,80,0.4)',
                    borderTop: '2px solid #555',
                    borderBottom: '2px solid #555',
                  }}
                />
              </div>
            )
          }

          const isActive = section.id === activeSectionId && mode === 'edit'
          return (
            <div key={section.id}>
              <div
                className={`section-overlay ${isExcluded ? 'excluded' : ''}${isActive ? ' active' : ''}`}
                style={{
                  left: `${left}%`,
                  right: `${right}%`,
                  background: isExcluded ? 'rgba(80,80,80,0.4)' : section.color + '40',
                  borderTop: `2px solid ${isExcluded ? '#555' : section.color}`,
                }}
              />
              {isFirstRow && (
                isPlayMode ? (
                  // Play mode: compact button at section start, width = content only
                  <button
                    className="section-seekbar-label section-seekbar-label-btn"
                    style={{ left: `calc(${labelLeft}% + 3px)`, color: section.color }}
                    data-flag="label"
                    onClick={() => onLabelClick?.(section.id)}
                  >
                    {section.label}
                  </button>
                ) : (
                  <span
                    className="section-seekbar-label"
                    style={{ left: `calc(${labelLeft}% + 3px)`, right: `${right}%`, color: section.color }}
                  >
                    {section.isExcluded ? '🚫 ' : ''}{section.label}
                  </span>
                )
              )}
            </div>
          )
        })}

        {/* Playhead */}
        {showPlayhead && (
          <div className="playhead" style={{ left: `${playheadPct}%` }} />
        )}

        {/* Flags (edit mode only) */}
        {mode === 'edit' &&
          sections.map((section) => {
            const isDragging = activeDragId === section.id
            return (
              <div key={section.id}>
                {inRow(section.startTime) && (
                  <div
                    className={`flag flag-start ${isDragging ? 'dragging' : ''}`}
                    style={{ left: `${xPct(section.startTime)}%`, borderTopColor: section.color }}
                    data-flag="start"
                    onPointerDown={(e) => onFlagPointerDown(e, section.id, true)}
                  />
                )}
                {inRow(section.endTime) && (
                  <div
                    className={`flag flag-end ${isDragging ? 'dragging' : ''}`}
                    style={{ left: `${xPct(section.endTime)}%`, borderBottomColor: section.color }}
                    data-flag="end"
                    onPointerDown={(e) => onFlagPointerDown(e, section.id, false)}
                  />
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
