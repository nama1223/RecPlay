import { useRef, useState } from 'react'
import { uploadToR2, UploadProgress } from '../utils/r2Upload'
import { buildR2PublicUrl, buildAppShareUrl, R2_PUBLIC_URL } from '../config'

interface Props {
  onFileLoad: (file: File) => void
  onUrlLoad: (url: string) => void
}

type Tab = 'local' | 'url' | 'upload'

export function FileLoader({ onFileLoad, onUrlLoad }: Props) {
  const [tab, setTab] = useState<Tab>('local')
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFileLoad(file)
  }

  const handleUrlSubmit = () => {
    const trimmed = url.trim()
    if (trimmed) onUrlLoad(trimmed)
  }

  const handleUploadSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setUploadedKey(null)
    setUploadError(null)
    setProgress(null)
    setCopied(false)
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    setProgress({ loaded: 0, total: uploadFile.size, percent: 0 })
    try {
      const key = await uploadToR2(uploadFile, (p) => setProgress(p))
      setUploadedKey(key)
    } catch (e) {
      setUploadError(String(e))
    } finally {
      setUploading(false)
    }
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fmt = (bytes: number) =>
    bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

  const r2Configured = Boolean(R2_PUBLIC_URL)
  const shareUrl = uploadedKey ? buildAppShareUrl(uploadedKey) : null
  const r2Url = uploadedKey ? buildR2PublicUrl(uploadedKey) : null

  return (
    <div className="file-loader">
      <div className="file-loader-logo">🎵</div>
      <div className="file-loader-title">RecPlay</div>
      <p className="file-loader-desc">練習録音の共有・編集プレーヤー</p>

      <div className="file-loader-tabs">
        <button className={`tab-btn ${tab === 'local' ? 'active' : ''}`} onClick={() => setTab('local')}>
          ファイルを開く
        </button>
        <button className={`tab-btn ${tab === 'url' ? 'active' : ''}`} onClick={() => setTab('url')}>
          URLで開く
        </button>
        <button className={`tab-btn ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')}>
          ↑ UL
        </button>
      </div>

      {tab === 'local' && (
        <div className="file-loader-body">
          <input ref={inputRef} type="file" accept="audio/*,.mp3" onChange={handleLocalFile} style={{ display: 'none' }} />
          <button className="primary-btn" onClick={() => inputRef.current?.click()}>
            MP3ファイルを選択
          </button>
          <p className="hint-text">選択したファイルはアップロードされません（端末内で再生）</p>
        </div>
      )}

      {tab === 'url' && (
        <div className="file-loader-body">
          <input
            className="url-input"
            type="url"
            placeholder="https://... (R2公開URLなど)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
          />
          <button className="primary-btn" onClick={handleUrlSubmit}>開く</button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="file-loader-body">
          {!r2Configured && (
            <div className="warning-box">
              ⚠️ R2公開URLが未設定です。<br />
              管理者が <code>VITE_R2_PUBLIC_URL</code> を設定してください。
            </div>
          )}

          {r2Configured && !uploadedKey && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                accept="audio/*,.mp3"
                onChange={handleUploadSelect}
                style={{ display: 'none' }}
              />
              {!uploadFile ? (
                <button className="primary-btn" onClick={() => uploadInputRef.current?.click()}>
                  アップロードするMP3を選択
                </button>
              ) : (
                <div className="upload-selected">
                  <div className="upload-filename">📄 {uploadFile.name}</div>
                  <div className="upload-filesize">{fmt(uploadFile.size)}</div>
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
                      {uploading ? 'アップロード中...' : '↑ R2にアップロード'}
                    </button>
                    {!uploading && (
                      <button className="secondary-btn" onClick={() => { setUploadFile(null); setProgress(null); setUploadError(null) }}>
                        選び直す
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {r2Configured && uploadedKey && (
            <div className="upload-complete">
              <div className="upload-success">✅ アップロード完了！</div>

              <p className="upload-share-label">📎 メンバーへの共有URL（アプリが開きます）</p>
              <div className="upload-url-box">
                <span className="upload-url-text">{shareUrl}</span>
                <button className="copy-btn" onClick={() => shareUrl && copyUrl(shareUrl)}>
                  {copied ? '✓' : 'コピー'}
                </button>
              </div>

              <p className="upload-share-label" style={{ marginTop: 8 }}>🔗 R2直リンク（MP3のみ）</p>
              <div className="upload-url-box secondary">
                <span className="upload-url-text">{r2Url}</span>
              </div>

              <button className="primary-btn" onClick={() => r2Url && onUrlLoad(r2Url)}>
                このファイルを今すぐ開く
              </button>
              <button className="secondary-btn" onClick={() => { setUploadFile(null); setUploadedKey(null); setProgress(null); setCopied(false) }}>
                別のファイルをアップロード
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
