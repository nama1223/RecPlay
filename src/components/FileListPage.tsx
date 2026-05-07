import { useEffect, useState } from 'react'
import { WORKER_URL, R2_PUBLIC_URL } from '../config'
import { OrgInfo } from './AuthPage'

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

function buildR2Url(key: string) {
  const base = R2_PUBLIC_URL.replace(/\/$/, '')
  return base ? `${base}/${encodeURIComponent(key)}` : ''
}

export function FileListPage({ org, onFileSelect, onLogout }: Props) {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
    const url = buildR2Url(file.key)
    if (!url) {
      alert('R2公開URLが設定されていません（VITE_R2_PUBLIC_URL）')
      return
    }
    onFileSelect(url, file.key, file.name)
  }

  return (
    <div className="file-list-page">
      <header className="app-header">
        <span className="app-title">🎵 RecPlay</span>
        <button className="change-btn" onClick={onLogout}>ログアウト</button>
      </header>

      <div className="file-list-body">
        <p className="file-list-org">🎵 {org.name}</p>
        <p className="file-list-hint">ファイルを選択して再生・編集できます</p>

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
