import { useState } from 'react'
import { Section, AppMode } from '../../types'
import { SectionItem } from './SectionItem'
import { downloadWithExcludes } from '../../utils/mp3Download'

interface Props {
  sections: Section[]
  mode: AppMode
  duration: number
  audioSrc: string
  editAdjustValues: number[]
  currentTime: number
  activeSectionId: string | null
  onPlay: (start: number, end: number) => void
  onUpdate: (id: string, updates: Partial<Section>) => void
  onDelete: (id: string) => void
  onToggleExclude: (id: string) => void
  onActivate: (id: string) => void
  onAddSection: () => void
  onExportJson: () => void
  onImportJson: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function SectionList({
  sections,
  mode,
  duration,
  audioSrc,
  editAdjustValues,
  activeSectionId,
  onPlay,
  onUpdate,
  onDelete,
  onToggleExclude,
  onActivate,
  onAddSection,
  onExportJson,
  onImportJson,
}: Props) {
  const [dlAll, setDlAll] = useState(false)

  const handleDownloadAll = async () => {
    if (!audioSrc) return
    setDlAll(true)
    try {
      await downloadWithExcludes(audioSrc, sections, duration, '録音_編集済み.mp3')
    } catch (e) {
      alert(`ダウンロードに失敗しました: ${e}`)
    } finally {
      setDlAll(false)
    }
  }

  return (
    <div className="section-list">
      <div className="section-list-header">
        <span className="section-list-title">区間リスト</span>
        <div className="section-list-actions">
          {mode === 'edit' && (
            <button className="icon-btn" onClick={onAddSection} title="現在位置に区間を追加">＋</button>
          )}
          <button className="icon-btn" onClick={onExportJson} title="区間データをJSONで保存">💾</button>
          <label className="icon-btn" title="区間データをJSONから読み込み">
            📂
            <input type="file" accept=".json" onChange={onImportJson} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {sections.length === 0 ? (
        <p className="no-sections">
          {mode === 'edit' ? '＋ボタンで区間を追加できます' : '区間が設定されていません'}
        </p>
      ) : (
        sections.map((s) => (
          <SectionItem
            key={s.id}
            section={s}
            mode={mode}
            duration={duration}
            audioSrc={audioSrc}
            editAdjustValues={editAdjustValues}
            isActive={activeSectionId === s.id}
            onPlay={onPlay}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onToggleExclude={onToggleExclude}
            onActivate={onActivate}
          />
        ))
      )}

      {mode === 'play' && audioSrc && sections.some((s) => s.isExcluded) && (
        <button className="download-all-btn" onClick={handleDownloadAll} disabled={dlAll}>
          {dlAll ? 'ダウンロード中...' : '⬇ 除外区間を除いた全体をDL'}
        </button>
      )}
    </div>
  )
}
