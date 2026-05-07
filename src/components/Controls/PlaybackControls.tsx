import { AppMode, Section } from '../../types'

interface Props {
  isPlaying: boolean
  mode: AppMode
  currentTime: number
  sections: Section[]
  onToggle: () => void
  onSkip: (delta: number) => void
  onSeek: (time: number) => void
  skipValues: number[]
  activeSectionId: string | null
  onMarkStart: () => void
  onMarkEnd: () => void
}

export function PlaybackControls({
  isPlaying,
  mode,
  currentTime,
  sections,
  onToggle,
  onSkip,
  onSeek,
  skipValues,
  activeSectionId,
  onMarkStart,
  onMarkEnd,
}: Props) {
  const negatives = skipValues.filter((v) => v < 0).sort((a, b) => a - b)
  const positives = skipValues.filter((v) => v > 0).sort((a, b) => a - b)

  const label = (v: number) => {
    const abs = Math.abs(v)
    return abs >= 60 ? `${v > 0 ? '+' : ''}${v / 60}分` : `${v > 0 ? '+' : ''}${v}s`
  }

  const handleBack = () => {
    const threshold = currentTime - 0.5
    const prev = sections
      .map((s) => s.startTime)
      .filter((t) => t < threshold)
      .sort((a, b) => b - a)[0]
    onSeek(prev ?? 0)
  }

  return (
    <div className="controls-area">
      <div className="playback-controls">
        <button className="skip-btn back-btn" onClick={handleBack} title="前の区間開始位置へ">⏮</button>
        {negatives.map((v) => (
          <button key={v} className="skip-btn" onClick={() => onSkip(v)}>{label(v)}</button>
        ))}
        <button className="play-btn" onClick={onToggle}>
          {isPlaying ? '⏹' : '▶'}
        </button>
        {positives.map((v) => (
          <button key={v} className="skip-btn" onClick={() => onSkip(v)}>{label(v)}</button>
        ))}
      </div>

      {/* Edit-mode mark buttons */}
      {mode === 'edit' && (
        <div className="mark-controls">
          {activeSectionId ? (
            <>
              <button className="mark-btn mark-start" onClick={onMarkStart}>
                ◀ ここから開始
              </button>
              <button className="mark-btn mark-end" onClick={onMarkEnd}>
                ここで終了 ▶
              </button>
            </>
          ) : (
            <span className="mark-hint">区間リストの区間を選択すると位置を設定できます</span>
          )}
        </div>
      )}
    </div>
  )
}
