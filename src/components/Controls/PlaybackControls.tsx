import { useEffect, useRef } from 'react'
import { AppMode, Section } from '../../types'

interface Props {
  isPlaying: boolean
  mode: AppMode
  currentTime: number
  sections: Section[]
  playbackRate: number
  onToggle: () => void
  onSkip: (delta: number) => void
  onSeek: (time: number) => void
  onPlaybackRateChange: (delta: number) => void
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
  playbackRate,
  onToggle,
  onSkip,
  onSeek,
  onPlaybackRateChange,
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
      .filter((s) => mode !== 'play' || !s.isExcluded)
      .map((s) => s.startTime)
      .filter((t) => t < threshold)
      .sort((a, b) => b - a)[0]
    onSeek(prev ?? 0)
  }

  // ── play-button ref: wheel (passive:false) + swipe ───────────────────────
  const playBtnRef = useRef<HTMLButtonElement>(null)
  // Keep a ref to the latest callback so the event listeners never go stale
  const rateChangeRef = useRef(onPlaybackRateChange)
  useEffect(() => { rateChangeRef.current = onPlaybackRateChange }, [onPlaybackRateChange])
  const toggleRef = useRef(onToggle)
  useEffect(() => { toggleRef.current = onToggle }, [onToggle])

  useEffect(() => {
    const btn = playBtnRef.current
    if (!btn) return

    let tY = 0
    let moved = false
    let lastWheel = 0

    // Wheel: 100ms throttle, one step per event
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheel < 100) return
      lastWheel = now
      rateChangeRef.current(e.deltaY > 0 ? -0.05 : 0.05)
    }

    // passive:false on touchstart prevents pull-to-refresh right from first touch
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      tY = e.touches[0].clientY
      moved = false
    }

    // Fire once per 20 px of travel; reset tY each time → no direction lock, no stocking
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const diff = tY - e.touches[0].clientY  // positive = swipe up
      if (Math.abs(diff) > 20) {
        moved = true
        rateChangeRef.current(diff > 0 ? 0.05 : -0.05)
        tY = e.touches[0].clientY  // consume the 20 px, reset reference
      }
    }

    // preventDefault suppresses synthesized click; tap (no move) toggles play
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault()
      if (!moved) toggleRef.current()
    }

    btn.addEventListener('wheel',      onWheel,      { passive: false })
    btn.addEventListener('touchstart', onTouchStart, { passive: false })
    btn.addEventListener('touchmove',  onTouchMove,  { passive: false })
    btn.addEventListener('touchend',   onTouchEnd,   { passive: false })

    return () => {
      btn.removeEventListener('wheel',      onWheel)
      btn.removeEventListener('touchstart', onTouchStart)
      btn.removeEventListener('touchmove',  onTouchMove)
      btn.removeEventListener('touchend',   onTouchEnd)
    }
  }, [])  // empty deps — uses refs for callbacks

  const rateLabel = `${Math.round(playbackRate * 100)}%`
  const rateAtNormal = Math.abs(playbackRate - 1.0) < 0.001

  return (
    <div className="controls-area">
      <div className="playback-controls">
        <button className="skip-btn back-btn" onClick={handleBack} title="前の区間開始位置へ">⏮</button>
        {negatives.map((v) => (
          <button key={v} className="skip-btn" onClick={() => onSkip(v)}>{label(v)}</button>
        ))}

        {/* Play button: wheel / swipe controls playback rate */}
        <div className="play-btn-wrap">
          <button
            className="play-btn"
            ref={playBtnRef}
            title="再生 / 停止｜スクロール・スワイプで再生速度"
          >
            {isPlaying ? '⏹' : '▶'}
          </button>
          <span className={`playback-rate-badge${rateAtNormal ? ' rate-normal' : ''}`}>
            {rateLabel}
          </span>
        </div>

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
