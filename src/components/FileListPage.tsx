import { useCallback, useEffect, useRef, useState } from 'react'
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

function fmt(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${WORKER_URL}/files?org=${encodeURIComponent(org.id)}`)
      const data = await res.json()
      setFiles(data.files ?? [])
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

  // Upload handlers
  const handleUploadSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setUploadError(null)
    setProgress(null)
    setUploadDone(false)
    doUpload(file)
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
    doUpload(file)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resetUpload = () => {
    setUploadFile(null)
    setProgress(null)
    setUploadError(null)
    setUploadDone(false)
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  return (
    <div className="file-list-page">
      <header className="app-header">
        <span className="app-title">🎵 {org.name}</span>
        <button className="change-btn" onClick={onLogout}>← 戻る</button>
      </header>

      <div className="file-list-body">

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

              {(uploadFile || uploading) && !uploadDone && (
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
    </div>
  )
}
