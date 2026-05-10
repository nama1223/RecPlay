import { useEffect, useRef, useState } from 'react'
import { Section, AppMode } from '../../types'
import { SectionItem } from './SectionItem'
import { downloadWithExcludes } from '../../utils/mp3Download'

type FilterMode = 'all' | 'play' | 'exclude'
type SortMode = 'registration' | 'startTime'

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
  scrollTarget?: { id: string; seq: number } | null
  onAddSection: () => void
  onUndo: () => void
  onRedo: () => void
  undoCount: number
  redoCount: number
  onReorder: (newOrder: Section[]) => void
}

const FILTER_LABELS: Record<FilterMode, string> = { all: '全て', play: '再生', exclude: '除外' }
const SORT_LABELS: Record<SortMode, string> = { registration: '登録順', startTime: '開始順' }
const FILTER_CYCLE: FilterMode[] = ['all', 'play', 'exclude']
const SORT_CYCLE: SortMode[] = ['registration', 'startTime']

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
  scrollTarget,
  onAddSection,
  onUndo,
  onRedo,
  undoCount,
  redoCount,
  onReorder,
}: Props) {
  const [dlAll, setDlAll] = useState(false)
  const [filter, setFilter] = useState<FilterMode>(() => mode === 'play' ? 'play' : 'all')
  const [sortMode, setSortMode] = useState<SortMode>('registration')
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragFromId = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll to the target section and auto-expand it
  useEffect(() => {
    if (!scrollTarget || !listRef.current) return
    const listEl = listRef.current
    const row = listEl.querySelector(`[data-section-id="${scrollTarget.id}"]`) as HTMLElement | null
    if (!row) return
    const header = listEl.querySelector('.section-list-header') as HTMLElement | null
    const headerH = header?.clientHeight ?? 0
    const listRect = listEl.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    listEl.scrollBy({ top: rowRect.top - listRect.top - headerH, behavior: 'smooth' })
  }, [scrollTarget])

  const cycleFilter = () => {
    setFilter((f) => FILTER_CYCLE[(FILTER_CYCLE.indexOf(f) + 1) % FILTER_CYCLE.length])
  }

  const cycleSort = () => {
    setSortMode((s) => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length])
  }

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

  // Filter then sort
  let displayed = sections.filter((s) => {
    if (filter === 'play') return !s.isExcluded
    if (filter === 'exclude') return s.isExcluded
    return true
  })
  if (sortMode === 'startTime') {
    displayed = [...displayed].sort((a, b) => a.startTime - b.startTime)
  }

  const canDrag = sortMode === 'registration'

  const handleDragStart = (id: string) => { dragFromId.current = id }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }

  const handleDrop = (toId: string) => {
    const fromId = dragFromId.current
    dragFromId.current = null
    setDragOverId(null)
    if (!fromId || fromId === toId) return
    const fromIdx = sections.findIndex((s) => s.id === fromId)
    const toIdx = sections.findIndex((s) => s.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...sections]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    onReorder(next)
  }

  const handleDragEnd = () => { dragFromId.current = null; setDragOverId(null) }

  return (
    <div className="section-list" ref={listRef}>
      <div className="section-list-header">
        <span className="section-list-title">区間リスト</span>
        <div className="section-list-toolbar">
          <button
            className={`sort-filter-btn${sortMode !== 'registration' ? ' active' : ''}`}
            onClick={cycleSort}
            title="ソート順を切り替え"
          >
            {SORT_LABELS[sortMode]}
          </button>
          <button
            className={`sort-filter-btn${filter !== 'all' ? ' active' : ''}`}
            onClick={cycleFilter}
            title="表示フィルタを切り替え"
          >
            {FILTER_LABELS[filter]}
          </button>
        </div>
        <div className="section-list-actions">
          {mode === 'edit' && (
            <button className="icon-btn" onClick={onAddSection} title="現在位置に区間を追加">＋</button>
          )}
          {/* Undo */}
          <button
            className="icon-btn badge-btn"
            onClick={onUndo}
            disabled={undoCount === 0}
            title={`元に戻す (${undoCount})`}
          >
            ↩
            {undoCount > 0 && <span className="icon-badge">{undoCount > 99 ? '99+' : undoCount}</span>}
          </button>
          {/* Redo */}
          <button
            className="icon-btn badge-btn"
            onClick={onRedo}
            disabled={redoCount === 0}
            title={`やり直す (${redoCount})`}
          >
            ↪
            {redoCount > 0 && <span className="icon-badge">{redoCount > 99 ? '99+' : redoCount}</span>}
          </button>
        </div>
      </div>

      {displayed.length === 0 ? (
        <p className="no-sections">
          {sections.length === 0
            ? (mode === 'edit' ? '＋ボタンで区間を追加できます' : '区間が設定されていません')
            : 'フィルタ条件に一致する区間がありません'}
        </p>
      ) : (
        displayed.map((s) => (
          <div
            key={s.id}
            data-section-id={s.id}
            className={`section-drag-row${dragOverId === s.id ? ' drag-over' : ''}`}
            draggable={canDrag}
            onDragStart={() => handleDragStart(s.id)}
            onDragOver={(e) => handleDragOver(e, s.id)}
            onDrop={() => handleDrop(s.id)}
            onDragEnd={handleDragEnd}
          >
            {canDrag && <span className="drag-handle" title="ドラッグで並べ替え">⠿</span>}
            <SectionItem
              section={s}
              mode={mode}
              duration={duration}
              audioSrc={audioSrc}
              editAdjustValues={editAdjustValues}
              isActive={activeSectionId === s.id}
              scrollTarget={scrollTarget}
              onPlay={onPlay}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onToggleExclude={onToggleExclude}
              onActivate={onActivate}
            />
          </div>
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
