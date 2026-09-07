import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WORKER_URL, buildWorkerAudioUrl } from '../config'
import { OrgInfo } from '../hooks/useOrgAuth'
import { uploadToR2, UploadProgress } from '../utils/r2Upload'

interface AudioFile {
  key: string
  name: string
  size: number
  uploadedAt: string
}

interface Props {
  org: OrgInfo
  onFileSelect: (url: string, fileKey: string, name: string) => void
  onRename?: (oldKey: string, newKey: string, newName: string) => void
  onLogout: () => void
}

type SortField = 'date' | 'name' | 'size'
type SortDir = 'asc' | 'desc'

// 容量超過時のモーダルのステップ
type OverflowStep = 'choose' | 'manual-select' | 'confirm-delete'

function fmt(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtMB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 削除予定日を計算 */
function calcExpiresAt(uploadedAt: string, retentionDays: number | null | undefined): Date | null {
  if (!retentionDays) return null
  const uploaded = new Date(uploadedAt)
  return new Date(uploaded.getTime() + retentionDays * 24 * 60 * 60 * 1000)
}

/** 削除予定日の表示文字列 */
function fmtExpiry(uploadedAt: string, retentionDays: number | null | undefined): string {
  const expires = calcExpiresAt(uploadedAt, retentionDays)
  if (!expires) return ''
  const now = new Date()
  const diffDays = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const dateStr = expires.toLocaleDateString('ja-JP')
  if (diffDays <= 0) return `🔴 期限切れ`
  if (diffDays <= 7) return `🟡 ${dateStr}(残${diffDays}日)`
  return `${dateStr}(残${diffDays}日)`
}

// ── LocalStorage: アップロードしたファイルのキーを記憶 ──────────────────────
// 同一ブラウザ/デバイスからアップロードしたファイルにだけ削除ボタンを表示するため。
// デバイスをまたぐ場合は管理パネル (Admin) から削除できます。
const LS_KEY = 'recplay-own-keys'

function getOwnKeys(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}
function addOwnKey(key: string): void {
  const keys = getOwnKeys()
  if (!keys.includes(key)) localStorage.setItem(LS_KEY, JSON.stringify([...keys, key]))
}
function removeOwnKey(key: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(getOwnKeys().filter((k) => k !== key)))
}
function replaceOwnKey(oldKey: string, newKey: string): void {
  const keys = getOwnKeys().map((k) => (k === oldKey ? newKey : k))
  localStorage.setItem(LS_KEY, JSON.stringify(keys))
}

export function FileListPage({ org, onFileSelect, onRename, onLogout }: Props) {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)

  // 容量情報
  const [totalSize, setTotalSize] = useState(0)
  const [storageLimitGB, setStorageLimitGB] = useState<number | null>(null)
  const [retentionDays, setRetentionDays] = useState<number | null>(null)

  // Sort state (default: newest first)
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Rename state
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Copy state
  const [copyingKey, setCopyingKey] = useState<string | null>(null)

  // Delete state
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  // Own keys from LocalStorage
  const [ownKeys, setOwnKeys] = useState<string[]>(() => getOwnKeys())

  // Upload state
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadDone, setUploadDone] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // 容量超過モーダル state
  const [overflowFile, setOverflowFile] = useState<File | null>(null)
  const [overflowStep, setOverflowStep] = useState<OverflowStep>('choose')
  const [manualDeleteKeys, setManualDeleteKeys] = useState<Set<string>>(new Set())
  const [deletingOverflow, setDeletingOverflow] = useState(false)
  // 自動削除候補（古い順にファイルを選ぶ）
  const [autoDeleteKeys, setAutoDeleteKeys] = useState<string[]>([])

  const storageLimitBytes = storageLimitGB != null ? storageLimitGB * 1024 * 1024 * 1024 : null

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${WORKER_URL}/files?org=${encodeURIComponent(org.id)}`)
      const data = await res.json()
      setFiles(data.files ?? [])
      setTotalSize(data.totalSize ?? 0)
      setStorageLimitGB(data.storageLimitGB ?? null)
      setRetentionDays(data.retentionDays ?? null)
    } catch {
      setError('ファイル一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [org.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute sorted files
  const sortedFiles = [...files].sort((a, b) => {
    let cmp = 0
    if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'ja')
    else if (sortField === 'date') cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
    else if (sortField === 'size') cmp = a.size - b.size
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'date' ? 'desc' : 'asc')
    }
  }

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const handleSelect = (file: AudioFile) => {
    if (renamingKey) return
    onFileSelect(buildWorkerAudioUrl(file.key), file.key, file.name)
  }

  // Rename handlers
  const startRename = (e: React.MouseEvent, file: AudioFile) => {
    e.stopPropagation()
    setRenamingKey(file.key)
    setRenameValue(file.name)
  }

  const commitRename = async () => {
    if (!renamingKey || !renameValue.trim()) { setRenamingKey(null); return }
    setRenaming(true)
    try {
      const res = await fetch(`${WORKER_URL}/files`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: renamingKey, newName: renameValue.trim() }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { newKey } = await res.json() as { newKey: string }
      // キーが変わった場合は LocalStorage も更新
      if (newKey && newKey !== renamingKey) {
        replaceOwnKey(renamingKey, newKey)
        setOwnKeys(getOwnKeys())
        onRename?.(renamingKey, newKey, renameValue.trim())
      }
      setRenamingKey(null)
      load()
    } catch (e) {
      alert(`名前変更に失敗しました: ${e}`)
    } finally {
      setRenaming(false)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setRenamingKey(null)
  }

  // Copy handler
  const handleCopy = async (e: React.MouseEvent, file: AudioFile) => {
    e.stopPropagation()
    if (copyingKey) return
    setCopyingKey(file.key)
    try {
      const res = await fetch(`${WORKER_URL}/files/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: file.key }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { newKey } = await res.json() as { newKey: string }
      // 複製したファイルも自分のものとして記録
      addOwnKey(newKey)
      setOwnKeys(getOwnKeys())
      load()
    } catch (e) {
      alert(`複製に失敗しました: ${e}`)
    } finally {
      setCopyingKey(null)
    }
  }

  // Delete handler
  const handleDelete = async (e: React.MouseEvent, file: AudioFile) => {
    e.stopPropagation()
    if (!confirm(`「${file.name}」を削除しますか？\n\nこの操作は元に戻せません。`)) return
    setDeletingKey(file.key)
    try {
      const res = await fetch(`${WORKER_URL}/files?key=${encodeURIComponent(file.key)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`${res.status}`)
      removeOwnKey(file.key)
      setOwnKeys(getOwnKeys())
      load()
    } catch (e) {
      alert(`削除に失敗しました: ${e}`)
    } finally {
      setDeletingKey(null)
    }
  }

  // ── 容量超過チェック付きアップロード ──────────────────────

  /** ファイル選択時の容量チェック。超過見込みならモーダルを表示、そうでなければ即アップロード */
  const checkAndUpload = (file: File) => {
    if (storageLimitBytes != null && totalSize + file.size > storageLimitBytes) {
      // 容量超過 → モーダルを表示
      setOverflowFile(file)
      setOverflowStep('choose')
      setManualDeleteKeys(new Set())

      // 自動削除候補を計算（古い順に、容量が足りるまで追加）
      const sorted = [...files].sort(
        (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
      )
      const needed = totalSize + file.size - storageLimitBytes
      let freed = 0
      const toDelete: string[] = []
      for (const f of sorted) {
        if (freed >= needed) break
        toDelete.push(f.key)
        freed += f.size
      }
      setAutoDeleteKeys(toDelete)
    } else {
      // 容量内 → そのままアップロード
      doUpload(file)
    }
  }

  // Upload handlers
  const handleUploadSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setUploadError(null)
    setProgress(null)
    setUploadDone(false)
    checkAndUpload(file)
  }

  const doUpload = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    setProgress({ loaded: 0, total: file.size, percent: 0 })
    try {
      const key = await uploadToR2(file, (p) => setProgress(p), org.id)
      // アップロード完了 → このデバイスでアップロードしたキーとして保存
      addOwnKey(key)
      setOwnKeys(getOwnKeys())
      setUploadDone(true)
      setUploadFile(null)
      load()
    } catch (e) {
      setUploadError(String(e))
    } finally {
      setUploading(false)
    }
  }

  const handleUploadDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleUploadDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false)
    }
  }, [])

  const handleUploadDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name)
    if (!isAudio) return
    setShowUpload(true)
    setUploadDone(false)
    setUploadError(null)
    setProgress(null)
    setUploadFile(file)
    checkAndUpload(file)
  }, [files, totalSize, storageLimitBytes]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetUpload = () => {
    setUploadFile(null)
    setProgress(null)
    setUploadError(null)
    setUploadDone(false)
    setOverflowFile(null)
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  // ── 容量超過モーダル: 削除実行後にアップロード ──────────────────────

  /** 手動選択時の合計削除サイズ */
  const manualDeleteSize = useMemo(() => {
    return files.filter((f) => manualDeleteKeys.has(f.key)).reduce((sum, f) => sum + f.size, 0)
  }, [files, manualDeleteKeys])

  /** 手動選択時: 削除後の容量 */
  const sizeAfterManualDelete = totalSize - manualDeleteSize

  /** 手動選択で十分な容量が確保できるか */
  const manualDeleteSufficient = overflowFile
    ? sizeAfterManualDelete + overflowFile.size <= (storageLimitBytes ?? Infinity)
    : false

  /** 自動削除候補の合計サイズ */
  const autoDeleteSize = useMemo(() => {
    return files.filter((f) => autoDeleteKeys.includes(f.key)).reduce((sum, f) => sum + f.size, 0)
  }, [files, autoDeleteKeys])

  /** 削除対象のキーリスト（最終確認画面で表示するもの） */
  const deleteTargetKeys = overflowStep === 'confirm-delete'
    ? (overflowStep === 'confirm-delete' && manualDeleteKeys.size > 0
        ? Array.from(manualDeleteKeys)
        : autoDeleteKeys)
    : []

  /** 最終確認で確定した削除対象 */
  const [confirmedDeleteKeys, setConfirmedDeleteKeys] = useState<string[]>([])

  /** 「古いものから自動削除」を選んだとき → 確認画面へ */
  const handleAutoDelete = () => {
    setConfirmedDeleteKeys(autoDeleteKeys)
    setOverflowStep('confirm-delete')
  }

  /** 「手動で選ぶ」を選んだとき → 手動選択画面へ */
  const handleManualSelect = () => {
    setManualDeleteKeys(new Set())
    setOverflowStep('manual-select')
  }

  /** 手動選択で決定 → 確認画面へ */
  const handleManualConfirm = () => {
    setConfirmedDeleteKeys(Array.from(manualDeleteKeys))
    setOverflowStep('confirm-delete')
  }

  /** 手動選択のチェックボックス切り替え */
  const toggleManualDelete = (key: string) => {
    setManualDeleteKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 最終確認: 削除実行 → アップロード */
  const executeDeleteAndUpload = async () => {
    if (!overflowFile || confirmedDeleteKeys.length === 0) return
    setDeletingOverflow(true)
    try {
      // 一括削除
      const res = await fetch(`${WORKER_URL}/files/batch`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: confirmedDeleteKeys }),
      })
      if (!res.ok) throw new Error(`削除失敗 (${res.status})`)
      // LocalStorage からも削除
      for (const key of confirmedDeleteKeys) removeOwnKey(key)
      setOwnKeys(getOwnKeys())
      // モーダルを閉じてアップロード
      const fileToUpload = overflowFile
      setOverflowFile(null)
      setConfirmedDeleteKeys([])
      doUpload(fileToUpload)
    } catch (e) {
      alert(`削除に失敗しました: ${e}`)
    } finally {
      setDeletingOverflow(false)
    }
  }

  /** モーダルキャンセル */
  const cancelOverflow = () => {
    setOverflowFile(null)
    setUploadFile(null)
    setConfirmedDeleteKeys([])
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  // ── 容量ゲージの計算 ──────────────────────

  const usagePercent = storageLimitBytes
    ? Math.min(100, (totalSize / storageLimitBytes) * 100)
    : 0

  const capacityDisplay = storageLimitBytes
    ? `${fmtMB(totalSize)} / ${fmtMB(storageLimitBytes)}`
    : `${fmtMB(totalSize)}`

  return (
    <div className="file-list-page">
      <header className="app-header">
        <span className="app-title">
          🎵 {org.name}
          <span className="header-capacity"> {capacityDisplay}</span>
        </span>
        <button className="change-btn" onClick={onLogout}>← 戻る</button>
      </header>

      <div className="file-list-body">

        {/* ── 容量ゲージ ── */}
        {storageLimitBytes != null && (
          <div className="capacity-gauge-wrap">
            <div className="capacity-gauge">
              <div
                className={`capacity-gauge-fill${usagePercent >= 90 ? ' danger' : usagePercent >= 70 ? ' warning' : ''}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <span className="capacity-gauge-text">{usagePercent.toFixed(0)}%</span>
          </div>
        )}

        {/* ── アップロードエリア ── */}
        <div
          className={`upload-section${isDragOver ? ' drag-over' : ''}`}
          onDragOver={handleUploadDragOver}
          onDragLeave={handleUploadDragLeave}
          onDrop={handleUploadDrop}
        >
          <button
            className="upload-toggle-btn"
            onClick={() => { setShowUpload((v) => !v); resetUpload() }}
          >
            {isDragOver ? '⬆ ドロップしてアップロード' : showUpload ? '▲ 閉じる' : '↑ MP3をアップロード'}
          </button>

          {showUpload && (
            <div className="upload-area">
              <input
                ref={uploadInputRef}
                type="file"
                accept="audio/*,.mp3"
                onChange={handleUploadSelect}
                style={{ display: 'none' }}
              />

              {!uploadFile && !uploading && !uploadDone && (
                <button className="primary-btn" onClick={() => uploadInputRef.current?.click()}>
                  ファイルを選択
                </button>
              )}

              {(uploadFile || uploading) && !uploadDone && !overflowFile && (
                <>
                  {uploadFile && <div className="upload-filename">📄 {uploadFile.name} ({fmt(uploadFile.size)})</div>}
                  {progress && (
                    <div className="progress-wrap">
                      <div className="progress-bar" style={{ width: `${progress.percent}%` }} />
                      <span className="progress-text">
                        {uploading
                          ? `アップロード中... ${progress.percent}% (${fmt(progress.loaded)} / ${fmt(progress.total)})`
                          : `${progress.percent}%`}
                      </span>
                    </div>
                  )}
                  {uploadError && (
                    <div className="error-text">
                      {uploadError}
                      <button className="secondary-btn" style={{ marginTop: 8 }} onClick={() => uploadInputRef.current?.click()}>
                        やり直す
                      </button>
                    </div>
                  )}
                </>
              )}

              {uploadDone && (
                <div className="upload-success">
                  ✅ アップロード完了！
                  <button className="secondary-btn" onClick={resetUpload}>
                    続けてアップロード
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── ソートバー ── */}
        <div className="file-sort-bar">
          <span className="file-sort-label">並べ替え：</span>
          {(['date', 'name', 'size'] as SortField[]).map((f) => (
            <button
              key={f}
              className={`sort-btn${sortField === f ? ' active' : ''}`}
              onClick={() => handleSortClick(f)}
            >
              {f === 'date' ? '日付' : f === 'name' ? '名前' : 'サイズ'}
              {sortIcon(f)}
            </button>
          ))}
        </div>

        {/* ── ファイル一覧 ── */}
        {loading && <p className="hint-text">読み込み中...</p>}
        {error && <p className="error-text">{error}</p>}

        {!loading && files.length === 0 && !error && (
          <p className="no-sections">アップロードされたファイルがありません</p>
        )}

        <div className="file-items">
          {sortedFiles.map((f) => {
            const isOwn = ownKeys.includes(f.key)
            const isCopying = copyingKey === f.key
            const isDeleting = deletingKey === f.key
            const expiryText = fmtExpiry(f.uploadedAt, retentionDays)
            return (
              <div key={f.key} className="file-item-row">
                {renamingKey === f.key ? (
                  <div className="file-rename-row">
                    <input
                      className="file-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      autoFocus
                      disabled={renaming}
                    />
                    <button className="rename-ok-btn" onClick={commitRename} disabled={renaming}>✓</button>
                    <button className="rename-cancel-btn" onClick={() => setRenamingKey(null)} disabled={renaming}>✕</button>
                  </div>
                ) : (
                  <button className="file-item-btn" onClick={() => handleSelect(f)}>
                    <span className="file-item-name">🎵 {f.name}</span>
                    <span className="file-item-meta">
                      {fmt(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('ja-JP')}
                      {expiryText && <span className="file-item-expiry"> · {expiryText}</span>}
                    </span>
                  </button>
                )}
                {renamingKey !== f.key && (
                  <div className="file-item-actions">
                    <button
                      className="file-action-icon"
                      onClick={(e) => startRename(e, f)}
                      title="名前を変更"
                    >✏️</button>
                    <button
                      className="file-action-icon copy-btn"
                      onClick={(e) => handleCopy(e, f)}
                      disabled={isCopying || !!copyingKey}
                      title="複製（区間設定も含めてコピー）"
                    >{isCopying ? '⏳' : '⧉'}</button>
                    {isOwn && (
                      <button
                        className="file-action-icon delete-btn"
                        onClick={(e) => handleDelete(e, f)}
                        disabled={isDeleting}
                        title="削除"
                      >{isDeleting ? '⏳' : '🗑'}</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button className="secondary-btn" onClick={load} style={{ marginTop: 16 }}>
          ↺ 更新
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          容量超過モーダル
          ══════════════════════════════════════════════════════════════ */}
      {overflowFile && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) cancelOverflow() }}>
          <div className="overflow-modal">
            {/* ── ステップ1: 方法を選ぶ ── */}
            {overflowStep === 'choose' && (
              <>
                <h3 className="overflow-title">⚠ 容量が不足しています</h3>
                <div className="overflow-info">
                  <div>アップロードファイル: <strong>{overflowFile.name}</strong> ({fmt(overflowFile.size)})</div>
                  <div>現在の使用量: {fmtMB(totalSize)} / {fmtMB(storageLimitBytes!)}</div>
                  <div>アップロード後: {fmtMB(totalSize + overflowFile.size)} → <span className="overflow-over">超過 +{fmtMB(totalSize + overflowFile.size - storageLimitBytes!)}</span></div>
                </div>

                <button className="overflow-option-btn" onClick={handleAutoDelete}>
                  <span className="overflow-option-title">🗑 古いものから自動削除</span>
                  <span className="overflow-option-desc">容量が足りるように古いファイルから順に削除します</span>
                </button>

                {/* 自動削除候補のプレビュー */}
                {autoDeleteKeys.length > 0 && (
                  <div className="overflow-auto-preview">
                    <div className="overflow-preview-label">削除候補（{autoDeleteKeys.length}件、{fmt(autoDeleteSize)}）:</div>
                    {autoDeleteKeys.map((key) => {
                      const f = files.find((f) => f.key === key)
                      return f ? (
                        <div key={key} className="overflow-preview-item">• {f.name} ({fmt(f.size)})</div>
                      ) : null
                    })}
                  </div>
                )}

                <button className="overflow-option-btn" onClick={handleManualSelect}>
                  <span className="overflow-option-title">✋ 手動で削除するファイルを選ぶ</span>
                  <span className="overflow-option-desc">削除するファイルを自分で選択できます</span>
                </button>

                <button className="overflow-cancel-btn" onClick={cancelOverflow}>キャンセル</button>
              </>
            )}

            {/* ── ステップ2: 手動選択 ── */}
            {overflowStep === 'manual-select' && (
              <>
                <h3 className="overflow-title">削除するファイルを選択</h3>

                {/* ゲージ表示 */}
                <div className="overflow-gauge-area">
                  <div className="overflow-gauge-row">
                    <span>現在: {fmtMB(totalSize)}</span>
                    <span>削除後: {fmtMB(sizeAfterManualDelete)}</span>
                    <span>上限: {fmtMB(storageLimitBytes!)}</span>
                  </div>
                  <div className="capacity-gauge">
                    {/* 削除後の使用量 */}
                    <div
                      className={`capacity-gauge-fill${manualDeleteSufficient ? '' : ' danger'}`}
                      style={{ width: `${Math.min(100, ((sizeAfterManualDelete + overflowFile.size) / storageLimitBytes!) * 100)}%` }}
                    />
                    {/* 現在の使用量（削除分を薄く表示） */}
                    <div
                      className="capacity-gauge-delete-zone"
                      style={{
                        left: `${Math.min(100, (sizeAfterManualDelete / storageLimitBytes!) * 100)}%`,
                        width: `${Math.min(100 - (sizeAfterManualDelete / storageLimitBytes!) * 100, (manualDeleteSize / storageLimitBytes!) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="overflow-gauge-summary">
                    選択中: {manualDeleteKeys.size}件 ({fmt(manualDeleteSize)}) →
                    {manualDeleteSufficient
                      ? <span className="overflow-ok"> ✅ 容量OK</span>
                      : <span className="overflow-over"> ❌ まだ{fmtMB(sizeAfterManualDelete + overflowFile.size - storageLimitBytes!)}超過</span>
                    }
                  </div>
                </div>

                {/* ファイルリスト */}
                <div className="overflow-file-list">
                  {[...files].sort(
                    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
                  ).map((f) => (
                    <label key={f.key} className={`overflow-file-item${manualDeleteKeys.has(f.key) ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={manualDeleteKeys.has(f.key)}
                        onChange={() => toggleManualDelete(f.key)}
                      />
                      <span className="overflow-file-name">{f.name}</span>
                      <span className="overflow-file-size">{fmt(f.size)}</span>
                    </label>
                  ))}
                </div>

                <div className="overflow-actions">
                  <button
                    className="primary-btn"
                    onClick={handleManualConfirm}
                    disabled={!manualDeleteSufficient}
                  >
                    {manualDeleteSufficient ? '選択したファイルを削除して続行' : '容量が足りません'}
                  </button>
                  <button className="overflow-cancel-btn" onClick={() => setOverflowStep('choose')}>← 戻る</button>
                </div>
              </>
            )}

            {/* ── ステップ3: 最終確認 ── */}
            {overflowStep === 'confirm-delete' && (
              <>
                <h3 className="overflow-title">⚠ 削除の最終確認</h3>
                <p className="overflow-confirm-text">以下のファイルを削除してからアップロードします。<br />この操作は元に戻せません。</p>

                <div className="overflow-delete-list">
                  {confirmedDeleteKeys.map((key) => {
                    const f = files.find((f) => f.key === key)
                    return f ? (
                      <div key={key} className="overflow-delete-item">
                        🗑 {f.name} <span className="overflow-file-size">({fmt(f.size)})</span>
                      </div>
                    ) : null
                  })}
                </div>

                <div className="overflow-confirm-summary">
                  合計削除: {confirmedDeleteKeys.length}件 ({fmt(files.filter((f) => confirmedDeleteKeys.includes(f.key)).reduce((s, f) => s + f.size, 0))})
                </div>

                <div className="overflow-actions">
                  <button
                    className="primary-btn overflow-delete-confirm-btn"
                    onClick={executeDeleteAndUpload}
                    disabled={deletingOverflow}
                  >
                    {deletingOverflow ? '処理中...' : '削除してアップロード'}
                  </button>
                  <button className="overflow-cancel-btn" onClick={() => setOverflowStep(manualDeleteKeys.size > 0 ? 'manual-select' : 'choose')}>
                    ← 戻る
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
