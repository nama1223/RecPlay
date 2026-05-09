import { useState } from 'react'
import { Section, AppMode } from '../../types'
import { formatTime } from '../../utils/timeFormat'
import { FlagEditor } from './FlagEditor'
import { downloadClip } from '../../utils/mp3Download'

interface Props {
  section: Section
  mode: AppMode
  duration: number
  audioSrc: string
  editAdjustValues: number[]
  isActive: boolean
  onPlay: (start: number, end: number) => void
  onUpdate: (id: string, updates: Partial<Section>) => void
  onDelete: (id: string) => void
  onToggleExclude: (id: string) => void
  onActivate: (id: string) => void
}

export function SectionItem({
  section,
  mode,
  duration,
  audioSrc,
  editAdjustValues,
  isActive,
  onPlay,
  onUpdate,
  onDelete,
  onToggleExclude,
  onActivate,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(section.label)

  const handleHeaderTap = () => {
    onActivate(section.id)
    setExpanded((v) => !v)
  }

  const handleLabelTap = (e: React.MouseEvent) => {
    if (mode !== 'edit') return
    e.stopPropagation()
    onActivate(section.id)
    setEditingLabel(true)
  }

  const saveLabel = () => {
    onUpdate(section.id, { label: labelVal })
    setEditingLabel(false)
  }

  const handleDownload = async () => {
    if (!audioSrc) return
    setDownloading(true)
    try {
      await downloadClip(audioSrc, section.startTime, section.endTime, duration, `${section.label}.mp3`)
    } catch (e) {
      alert(`ダウンロードに失敗しました: ${e}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className={`section-item ${section.isExcluded ? 'excluded' : ''} ${isActive ? 'active' : ''}`}
      style={{ borderLeft: `4px solid ${section.color}` }}
    >
      <div className="section-item-main" onClick={handleHeaderTap}>
        <div className="section-item-info">
          {editingLabel ? (
            <input
              className="label-input"
              value={labelVal}
              autoFocus
              onChange={(e) => setLabelVal(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => e.key === 'Enter' && saveLabel()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className={`section-label ${mode === 'edit' ? 'editable' : ''}`}
              onClick={handleLabelTap}
              title={mode === 'edit' ? 'タップで名前を編集' : undefined}
            >
              {section.isExcluded ? '🚫 ' : ''}
              {section.label}
              {mode === 'edit' && <span className="edit-hint"> ✏️</span>}
            </span>
          )}
          <span className="section-time">
            {formatTime(section.startTime)} – {formatTime(section.endTime)}
          </span>
        </div>
        <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="section-item-actions">
          {mode === 'play' && (
            <>
              <button className="action-btn play" onClick={() => onPlay(section.startTime, section.endTime)}>
                ▶ 区間再生
              </button>
              {audioSrc && (
                <button className="action-btn download" onClick={handleDownload} disabled={downloading}>
                  {downloading ? '...' : '⬇ クリップDL'}
                </button>
              )}
            </>
          )}

          {mode === 'edit' && (
            <>
              <button
                className={`action-btn ${section.isExcluded ? 'restore' : 'exclude'}`}
                onClick={() => onToggleExclude(section.id)}
              >
                {section.isExcluded ? '✓ 除外を解除' : '🚫 除外区間に設定'}
              </button>
              <FlagEditor
                section={section}
                duration={duration}
                editAdjustValues={editAdjustValues}
                onUpdate={onUpdate}
                onClose={() => setExpanded(false)}
              />
              <button
                className="action-btn delete compact"
                onClick={() => { if (confirm(`「${section.label}」を削除しますか？`)) onDelete(section.id) }}
              >
                🗑 削除
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
