import { useRef, useState } from 'react'
import { uploadToR2, UploadProgress } from '../utils/r2Upload'
import { buildR2PublicUrl, R2_PUBLIC_URL } from '../config'

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

  // アップロード状態
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

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
    setUploadedUrl(null)
    setUploadError(null)
    setProgress(null)
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    setProgress({ loaded: 0, total: uploadFile.size, percent: 0 })

    try {
      const key = await uploadToR2(uploadFile, (p) => setProgress(p))
      const publicUrl = buildR2PublicUrl(key)
      setUploadedUrl(publicUrl)
    } catch (e) {
      setUploadError(String(e))
    } finally {
      setUploading(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const r2Configured = Boolean(R2_PUBLIC_URL)

  return (
    <div className="file-loader">
      <div className="file-loader-logo">🎵 RecPlay</div>
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

      {/* ── ローカルファイル ── */}
      {tab === 'local' && (
        <div className="file-loader-body">
          <input ref={inputRef} type="file" accept="audio/*,.mp3" onChange={handleLocalFile} style={{ display: 'none' }} />
          <button className="primary-btn" onClick={() => inputRef.current?.click()}>
            MP3ファイルを選択
          </button>
          <p className="hint-text">選択したファイルはアップロードされません（端末内で再生）</p>
        </div>
      )}

      {/* ── URLで開く ── */}
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
          <button className="primary-btn" onClick={handleUrlSubmit}>
            開く
          </button>
        </div>
      )}

      {/* ── R2アップロード ── */}
      {tab === 'upload' && (
        <div className="file-loader-body">
          {!r2Configured && (
            <div className="warning-box">
              ⚠️ R2公開URLが未設定です。<br />
              管理者が <code>VITE_R2_PUBLIC_URL</code> を設定してください。
            </div>
          )}

          {r2Configured && !uploadedUrl && (
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
                  <div className="upload-filesize">{formatBytes(uploadFile.size)}</div>

                  {progress && (
                    <div className="progress-wrap">
                      <div className="progress-bar" style={{ width: `${progress.percent}%` }} />
                      <span className="progress-text">
                        {progress.percent}% ({formatBytes(progress.loaded)} / {formatBytes(progress.total)})
                      </span>
                    </div>
                  )}

                  {uploadError && <div className="error-text">{uploadError}</div>}

                  <div className="upload-btns">
                    <button
                      className="primary-btn"
                      onClick={handleUpload}
                      disabled={uploading}
                    >
                      {uploading ? 'アップロード中...' : '↑ R2にアップロード'}
                    </button>
                    {!uploading && (
                      <button
                        className="secondary-btn"
                        onClick={() => { setUploadFile(null); setProgress(null); setUploadError(null) }}
                      >
                        選び直す
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* アップロード完了 */}
          {uploadedUrl && (
            <div className="upload-complete">
              <div className="upload-success">✅ アップロード完了</div>
              <p className="upload-share-label">共有URL（メンバーに送ってください）:</p>
              <div className="upload-url-box">
                <span className="upload-url-text">{uploadedUrl}</span>
                <button
                  className="copy-btn"
                  onClick={() => navigator.clipboard.writeText(uploadedUrl)}
                >
                  コピー
                </button>
              </div>
              <button className="primary-btn" onClick={() => onUrlLoad(uploadedUrl)}>
                このファイルを今すぐ開く
              </button>
              <button
                className="secondary-btn"
                onClick={() => { setUploadFile(null); setUploadedUrl(null); setProgress(null) }}
              >
                別のファイルをアップロード
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
