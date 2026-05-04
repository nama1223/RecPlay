interface Props {
  isPlaying: boolean
  onToggle: () => void
  onSkip: (delta: number) => void
  skipValues: number[]
}

export function PlaybackControls({ isPlaying, onToggle, onSkip, skipValues }: Props) {
  const negatives = skipValues.filter((v) => v < 0).sort((a, b) => a - b)
  const positives = skipValues.filter((v) => v > 0).sort((a, b) => a - b)

  const label = (v: number) => {
    const abs = Math.abs(v)
    return abs >= 60 ? `${v > 0 ? '+' : ''}${v / 60}分` : `${v > 0 ? '+' : ''}${v}秒`
  }

  return (
    <div className="playback-controls">
      {negatives.map((v) => (
        <button key={v} className="skip-btn" onClick={() => onSkip(v)}>
          {label(v)}
        </button>
      ))}
      <button className="play-btn" onClick={onToggle}>
        {isPlaying ? '⏹' : '▶'}
      </button>
      {positives.map((v) => (
        <button key={v} className="skip-btn" onClick={() => onSkip(v)}>
          {label(v)}
        </button>
      ))}
    </div>
  )
}
