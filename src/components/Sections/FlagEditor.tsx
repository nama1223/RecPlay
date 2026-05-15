import { useState } from 'react'
import { Section } from '../../types'
import { formatTime } from '../../utils/timeFormat'

interface Props {
  section: Section
  duration: number
  editAdjustValues: number[]
  onUpdate: (id: string, updates: Partial<Section>) => void
  onClose: () => void
  onPlay: (start: number, end: number) => void
}

export function FlagEditor({ section, duration, editAdjustValues, onUpdate, onClose, onPlay }: Props) {
  const [startInput, setStartInput] = useState(String(section.startTime.toFixed(1)))
  const [endInput, setEndInput] = useState(String(section.endTime.toFixed(1)))

  const applyStart = (val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n)) onUpdate(section.id, { startTime: Math.max(0, Math.min(n, section.endTime - 0.1)) })
  }

  const applyEnd = (val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n)) onUpdate(section.id, { endTime: Math.min(duration, Math.max(n, section.startTime + 0.1)) })
  }

  const adjustStart = (delta: number) => {
    const newVal = Math.max(0, Math.min(section.startTime + delta, section.endTime - 0.1))
    onUpdate(section.id, { startTime: newVal })
    setStartInput(newVal.toFixed(1))
  }

  const adjustEnd = (delta: number) => {
    const newVal = Math.min(duration, Math.max(section.endTime + delta, section.startTime + 0.1))
    onUpdate(section.id, { endTime: newVal })
    setEndInput(newVal.toFixed(1))
  }

  const adjLabel = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  return (
    <div className="flag-editor">
      <div className="flag-editor-header">
        <span style={{ color: section.color }}>●</span>
        <button
          className="flag-play-btn"
          onClick={() => onPlay(section.startTime, section.endTime)}
          title="区間全体を再生"
        >▶ 区間再生</button>
        <button
          className="flag-play-btn"
          onClick={() => onPlay(Math.max(section.startTime, section.endTime - 3), section.endTime)}
          title="終了位置の直前3秒を再生"
        >▶ ラスト3秒</button>
        <span style={{ flex: 1 }} />
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="flag-editor-row">
        <span className="flag-editor-label">開始</span>
        <input
          className="time-input"
          type="number"
          step="0.1"
          value={startInput}
          onChange={(e) => setStartInput(e.target.value)}
          onBlur={(e) => applyStart(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyStart(startInput)}
        />
        <span className="flag-editor-fmt">{formatTime(section.startTime)}</span>
      </div>
      <div className="adjust-btns">
        {editAdjustValues.map((v) => (
          <button key={v} className="adj-btn" onClick={() => adjustStart(v)}>
            {adjLabel(v)}
          </button>
        ))}
      </div>

      <div className="flag-editor-row">
        <span className="flag-editor-label">終了</span>
        <input
          className="time-input"
          type="number"
          step="0.1"
          value={endInput}
          onChange={(e) => setEndInput(e.target.value)}
          onBlur={(e) => applyEnd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyEnd(endInput)}
        />
        <span className="flag-editor-fmt">{formatTime(section.endTime)}</span>
      </div>
      <div className="adjust-btns">
        {editAdjustValues.map((v) => (
          <button key={v} className="adj-btn" onClick={() => adjustEnd(v)}>
            {adjLabel(v)}
          </button>
        ))}
      </div>
    </div>
  )
}
