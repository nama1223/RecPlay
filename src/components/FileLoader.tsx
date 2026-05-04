import { useRef, useState } from 'react'

interface Props {
  onFileLoad: (file: File) => void
  onUrlLoad: (url: string) => void
}

export function FileLoader({ onFileLoad, onUrlLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [urlMode, setUrlMode] = useState(false)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFileLoad(file)
  }

  const handleUrlSubmit = () => {
    const trimmed = url.trim()
    if (trimmed) onUrlLoad(trimmed)
  }

  return (
    <div className="file-loader">
      <div className="file-loader-logo">🎵 RecPlay</div>
      <p className="file-loader-desc">練習録音の共有・編集プレーヤー</p>

      <div className="file-loader-tabs">
        <button
          className={`tab-btn ${!urlMode ? 'active' : ''}`}
          onClick={() => setUrlMode(false)}
        >
          ファイルを開く
        </button>
        <button
          className={`tab-btn ${urlMode ? 'active' : ''}`}
          onClick={() => setUrlMode(true)}
        >
          URLで開く
        </button>
      </div>

      {!urlMode ? (
        <div className="file-loader-body">
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
          <button className="primary-btn" onClick={() => inputRef.current?.click()}>
            MP3ファイルを選択
          </button>
        </div>
      ) : (
        <div className="file-loader-body">
          <input
            className="url-input"
            type="url"
            placeholder="https://... (R2やGoogle Driveの直リンク)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
          />
          <button className="primary-btn" onClick={handleUrlSubmit}>
            開く
          </button>
        </div>
      )}
    </div>
  )
}
