import { useEffect, useRef, useState } from 'react'
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
  onLogout: () => void
}

function fmt(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}


export function FileListPage({ org, onFileSelect, onLogout }: Props) {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)

  // Upload state
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadDone, setUploadDone] = useState(false)

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

  const handleSelect = (file: AudioFile) => {
    onFileSelect(buildWorkerAudioUrl(file.key), file.key, file.name)
  }

  const handleUploadSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setUploadError(null)
    setProgress(null)
    setUploadDone(false)
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    setProgress({ loaded: 0, total: uploadFile.size, percent: 0 })
    try {
      await uploadToR2(uploadFile, (p) => setProgress(p), org.id)
      setUploadDone(true)
      setUploadFile(null)
      load()
    } catch (e) {
      setUploadError(String(e))
    } finally {
      setUploading(false)
    }
  }

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
        <div className="upload-section">
          <button
            className="upload-toggle-btn"
            onClick={() => { setShowUpload((v) => !v); resetUpload() }}
          >
            {showUpload ? '▲ 閉じる' : '↑ MP3をアップロード'}
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

              {!uploadFile && !uploadDone && (
                <button className="primary-btn" onClick={() => uploadInputRef.current?.click()}>
                  ファイルを選択
                </button>
              )}

              {uploadFile && !uploadDone && (
                <>
                  <div className="upload-filename">📄 {uploadFile.name} ({fmt(uploadFile.size)})</div>
                  {progress && (
                    <div className="progress-wrap">
                      <div className="progress-bar" style={{ width: `${progress.percent}%` }} />
                      <span className="progress-text">
                        {progress.percent}% ({fmt(progress.loaded)} / {fmt(progress.total)})
                      </span>
                    </div>
                  )}
                  {uploadError && <div className="error-text">{uploadError}</div>}
                  <div className="upload-btns">
                    <button className="primary-btn" onClick={handleUpload} disabled={uploading}>
                      {uploading ? 'アップロード中...' : '↑ アップロード'}
                    </button>
                    {!uploading && (
                      <button className="secondary-btn" onClick={resetUpload}>選び直す</button>
                    )}
                  </div>
                </>
              )}

              {uploadDone && (
                <div className="upload-success">
                  ✅ アップロード完了！
                  <button className="secondary-btn" onClick={() => { resetUpload() }}>
                    続けてアップロード
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── ファイル一覧 ── */}
        {loading && <p className="hint-text">読み込み中...</p>}
        {error && <p className="error-text">{error}</p>}

        {!loading && files.length === 0 && !error && (
          <p className="no-sections">アップロードされたファイルがありません</p>
        )}

        <div className="file-items">
          {files.map((f) => (
            <button key={f.key} className="file-item-btn" onClick={() => handleSelect(f)}>
              <span className="file-item-name">🎵 {f.name}</span>
              <span className="file-item-meta">
                {fmt(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('ja-JP')}
              </span>
            </button>
          ))}
        </div>

        <button className="secondary-btn" onClick={load} style={{ marginTop: 16 }}>
          ↺ 更新
        </button>
      </div>
    </div>
  )
}
