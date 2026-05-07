import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSeekBar } from './hooks/useSeekBar'
import { useSettings } from './hooks/useSettings'
import { useWaveform } from './hooks/useWaveform'
import { useSectionSync } from './hooks/useSectionSync'
import { SeekBar } from './components/SeekBar/SeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { FileLoader } from './components/FileLoader'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthPage, OrgInfo } from './components/AuthPage'
import { FileListPage } from './components/FileListPage'
import { AdminPage } from './components/AdminPage'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section } from './types'
import { R2_PUBLIC_URL } from './config'
import './App.css'

type Screen = 'auth' | 'files' | 'admin' | 'player'

// Derive R2 key from a public R2 URL
function keyFromUrl(url: string): string | null {
  const base = R2_PUBLIC_URL.replace(/\/$/, '')
  if (!base) return null
  try {
    const decoded = decodeURIComponent(url)
    if (decoded.startsWith(base + '/')) return decoded.slice(base.length + 1)
    // fallback: last path segment
    return new URL(url).pathname.slice(1)
  } catch {
    return null
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('auth')
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [mode, setMode] = useState<AppMode>('play')
  const [fileLoaded, setFileLoaded] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileKey, setFileKey] = useState<string | null>(null)
  const [showFileLoader, setShowFileLoader] = useState(false)

  const {
    audioRef, currentTime, duration, isPlaying, src,
    togglePlayPause, seek, skip, playSection,
    loadFile, loadUrl, setExcludedZones, setSkipExcluded,
  } = useAudioPlayer()

  const { sections, addSection, updateSection, deleteSection, toggleExclude, importSections } = useSections()
  const { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom } = useSeekBar(duration)
  const { settings, updateSettings } = useSettings()
  const { samples: waveformSamples } = useWaveform(src, duration)

  const onRemoteUpdate = useCallback((secs: Section[]) => {
    importSections(secs)
  }, [importSections])

  useSectionSync(fileKey, mode, sections, onRemoteUpdate)

  // ?url= param → jump straight to player
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlParam = params.get('url')
    if (urlParam) {
      const decoded = decodeURIComponent(urlParam)
      loadUrl(decoded)
      setFileName(decoded.split('/').pop() ?? decoded)
      setFileKey(keyFromUrl(decoded))
      setFileLoaded(true)
      setScreen('player')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (duration > 0) initZoom(duration)
  }, [duration, initZoom])

  useEffect(() => {
    const excluded = sections.filter((s) => s.isExcluded).map((s) => ({ start: s.startTime, end: s.endTime }))
    setExcludedZones(excluded)
  }, [sections, setExcludedZones])

  useEffect(() => {
    setSkipExcluded(mode === 'play')
  }, [mode, setSkipExcluded])

  const handleFileLoad = (file: File) => {
    loadFile(file)
    setFileName(file.name)
    setFileKey(null) // local file → no sync
    setFileLoaded(true)
    setShowFileLoader(false)
    setScreen('player')
  }

  const handleUrlLoad = (url: string) => {
    const decoded = decodeURIComponent(url)
    loadUrl(decoded)
    setFileName(decoded.split('/').pop() ?? decoded)
    setFileKey(keyFromUrl(decoded))
    setFileLoaded(true)
    setShowFileLoader(false)
    setScreen('player')
  }

  const handleFileSelect = (url: string, key: string, name: string) => {
    loadUrl(url)
    setFileName(name)
    setFileKey(key)
    setFileLoaded(true)
    setScreen('player')
    importSections([])
  }

  const handleChangeFile = () => {
    if (sections.length > 0 || duration > 0) {
      if (!confirm('現在の作業内容（区間設定など）が失われます。\nJSONで保存してから変更することをお勧めします。\n\n続けますか？')) return
    }
    setShowFileLoader(true)
  }

  const handleCloseFileLoader = () => setShowFileLoader(false)

  // activeSectionId for mark-start/end
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  const handleAddSection = () => {
    const start = currentTime
    const end = Math.min(currentTime + 30, duration || currentTime + 30)
    addSection(start, end)
  }

  const handleMarkStart = () => {
    if (!activeSectionId) return
    const sec = sections.find((s) => s.id === activeSectionId)
    if (!sec) return
    updateSection(activeSectionId, { startTime: Math.min(currentTime, sec.endTime - 0.1) })
  }

  const handleMarkEnd = () => {
    if (!activeSectionId) return
    const sec = sections.find((s) => s.id === activeSectionId)
    if (!sec) return
    updateSection(activeSectionId, { endTime: Math.max(currentTime, sec.startTime + 0.1) })
  }

  const handleExportJson = () => {
    const data = { version: 1, filename: fileName, duration, sections }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.replace(/\.[^.]+$/, '')}_sections.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (Array.isArray(data.sections)) importSections(data.sections as Section[])
      } catch {
        alert('JSONの読み込みに失敗しました')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleLogout = () => {
    sessionStorage.removeItem('adminPassword')
    setOrg(null)
    setScreen('auth')
    setFileLoaded(false)
    setFileName('')
    setFileKey(null)
    importSections([])
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  if (screen === 'auth') {
    return (
      <AuthPage
        onAuth={(o) => { setOrg(o); setScreen('files') }}
        onAdmin={() => setScreen('admin')}
      />
    )
  }

  if (screen === 'admin') {
    return <AdminPage onLogout={handleLogout} />
  }

  if (screen === 'files' && org) {
    return (
      <FileListPage
        org={org}
        onFileSelect={handleFileSelect}
        onLogout={handleLogout}
      />
    )
  }

  // ── Player ───────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />

      <header className="app-header">
        <span className="app-title">🎵 RecPlay</span>
        <ModeSelector mode={mode} onChange={setMode} />
      </header>

      {/* ファイル選択モーダル（変更時） */}
      {showFileLoader && (
        <div className="modal-overlay">
          <button className="modal-close" onClick={handleCloseFileLoader}>✕ キャンセル</button>
          <FileLoader onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
        </div>
      )}

      {/* プレーヤー本体 */}
      {fileLoaded && !showFileLoader && (
        <div className="player">
          <div className="file-bar">
            <span className="file-name" title={fileName}>{fileName}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {org && (
                <button className="change-btn" onClick={() => setScreen('files')}>
                  ← 一覧
                </button>
              )}
              <button className="change-btn" onClick={handleChangeFile}>変更</button>
            </div>
          </div>

          <div className="time-bar">
            <span className="current-time">{formatTime(currentTime)}</span>
            <span className="time-sep">/</span>
            <span className="total-time">{formatTime(duration)}</span>
            {fileKey && <span className="sync-indicator" title="区間データは自動同期されます">☁</span>}
          </div>

          <SeekBar
            currentTime={currentTime}
            duration={duration}
            secondsPerRow={secondsPerRow}
            numRows={numRows}
            zoomIndex={zoomIndex}
            sections={sections}
            mode={mode}
            waveformSamples={waveformSamples}
            onSeek={seek}
            onSectionUpdate={updateSection}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />

          {mode !== 'settings' && (
            <PlaybackControls
              isPlaying={isPlaying}
              mode={mode}
              currentTime={currentTime}
              sections={sections}
              onToggle={togglePlayPause}
              onSkip={skip}
              onSeek={seek}
              skipValues={settings.skipValues}
              activeSectionId={activeSectionId}
              onMarkStart={handleMarkStart}
              onMarkEnd={handleMarkEnd}
            />
          )}

          {mode !== 'settings' && (
            <SectionList
              sections={sections}
              mode={mode}
              duration={duration}
              audioSrc={src ?? ''}
              editAdjustValues={settings.editAdjustValues}
              currentTime={currentTime}
              activeSectionId={activeSectionId}
              onPlay={playSection}
              onUpdate={updateSection}
              onDelete={deleteSection}
              onToggleExclude={toggleExclude}
              onActivate={setActiveSectionId}
              onAddSection={handleAddSection}
              onExportJson={handleExportJson}
              onImportJson={handleImportJson}
            />
          )}

          {mode === 'settings' && (
            <SettingsPanel settings={settings} onUpdate={updateSettings} />
          )}
        </div>
      )}

      {/* ファイル未ロード（?urlなし・プレーヤー起動） */}
      {!fileLoaded && !showFileLoader && (
        <div className="app-body">
          <FileLoader onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
        </div>
      )}
    </div>
  )
}
