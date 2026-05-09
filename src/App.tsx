import { useCallback, useEffect, useState } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSeekBar } from './hooks/useSeekBar'
import { useSettings } from './hooks/useSettings'
import { useWaveform } from './hooks/useWaveform'
import { useSectionSync } from './hooks/useSectionSync'
import { OrgInfo, getStoredOrgs, storeOrg } from './hooks/useOrgAuth'
import { SeekBar } from './components/SeekBar/SeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { FileLoader } from './components/FileLoader'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthPage } from './components/AuthPage'
import { FileListPage } from './components/FileListPage'
import { AdminPage } from './components/AdminPage'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section } from './types'
import { R2_PUBLIC_URL, WORKER_URL, buildWorkerAudioUrl } from './config'
import './App.css'

type Screen = 'auth' | 'files' | 'admin' | 'player'

function keyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Worker audio URL: .../audio?key=...
    if (parsed.pathname.endsWith('/audio')) {
      return parsed.searchParams.get('key')
    }
    // R2 public URL (legacy / direct link)
    const base = R2_PUBLIC_URL.replace(/\/$/, '')
    if (base) {
      const decoded = decodeURIComponent(url)
      if (decoded.startsWith(base + '/')) return decoded.slice(base.length + 1)
    }
    return null
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
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  const {
    audioRef, currentTime, duration, isPlaying, src,
    togglePlayPause, seek, skip, playSection,
    loadFile, loadUrl, setExcludedZones, setSkipExcluded,
  } = useAudioPlayer()

  const { sections, addSection, updateSection, deleteSection, toggleExclude, importSections, reorderSections } = useSections()
  const { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom } = useSeekBar(duration)
  const { settings, updateSettings } = useSettings()
  const { samples: waveformSamples } = useWaveform(src, duration)
  const onRemoteUpdate = useCallback((secs: Section[]) => importSections(secs), [importSections])
  const { lastSyncedAt, isDirty } = useSectionSync(fileKey, mode, sections, onRemoteUpdate)

  // ── ?url= パラメータ → 自動ログイン & 直接プレーヤー ──────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlParam = params.get('url')
    if (!urlParam) return

    const decoded = decodeURIComponent(urlParam)
    const key = keyFromUrl(decoded)
    const orgId = key?.split('/')[0]

    // キーが取れた場合はWorker経由で再生、なければURLをそのまま使う
    const audioUrl = key ? buildWorkerAudioUrl(key) : decoded

    const openPlayer = (detectedOrg?: OrgInfo) => {
      loadUrl(audioUrl)
      setFileName(decoded.split('/').pop() ?? decoded)
      setFileKey(key)
      setFileLoaded(true)
      if (detectedOrg) setOrg(detectedOrg)
      setScreen('player')
    }

    if (orgId && orgId.startsWith('org_')) {
      // すでにLocalStorageにある？
      const stored = getStoredOrgs()
      const existing = stored.find((o) => o.id === orgId)
      if (existing) {
        openPlayer(existing)
        return
      }
      // Worker から団体名を取得して自動ログイン
      fetch(`${WORKER_URL}/org?id=${orgId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          const detectedOrg: OrgInfo | undefined = data ? { id: data.id, name: data.name } : undefined
          if (detectedOrg) storeOrg(detectedOrg)
          openPlayer(detectedOrg)
        })
        .catch(() => openPlayer())
    } else {
      openPlayer()
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
    setFileKey(null)
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

  // ── レンダー ──────────────────────────────────────────────────────────────
  // <audio> はFragmentの先頭に固定し、画面遷移でも同じDOM要素を使い続ける。
  // 親要素が変わるとReactが要素を作り直し、useEffectで登録したリスナーが失われるため。
  return (
    <>
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />

      {screen === 'auth' && (
        <AuthPage
          onAuth={(o) => { setOrg(o); setScreen('files') }}
          onAdmin={() => setScreen('admin')}
        />
      )}

      {screen === 'admin' && <AdminPage onLogout={handleLogout} />}

      {screen === 'files' && org && (
        <FileListPage
          org={org}
          onFileSelect={handleFileSelect}
          onLogout={handleLogout}
        />
      )}

      {screen === 'player' && (
        <div className="app">
          <header className="app-header">
            <span className="app-title">🎵 {org ? org.name : 'RecPlay'}</span>
            <ModeSelector mode={mode} onChange={setMode} />
          </header>

          {showFileLoader && (
            <div className="modal-overlay">
              <button className="modal-close" onClick={() => setShowFileLoader(false)}>✕ キャンセル</button>
              <FileLoader onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} orgId={org?.id} />
            </div>
          )}

          {fileLoaded && !showFileLoader && (
            <div className="player">
              <div className="file-bar">
                <span className="file-name" title={fileName}>{fileName}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {fileKey && (
                    <button
                      className="change-btn"
                      title="このファイルのURLをコピー"
                      onClick={() => {
                        const url = `${location.origin}${location.pathname}?url=${encodeURIComponent(buildWorkerAudioUrl(fileKey))}`
                        navigator.clipboard.writeText(url).then(() => alert('URLをコピーしました'))
                      }}
                    >🔗</button>
                  )}
                  {org && (
                    <button className="change-btn" onClick={() => setScreen('files')}>← 一覧</button>
                  )}
                  <button className="change-btn" onClick={handleChangeFile}>変更</button>
                </div>
              </div>

              <div className="time-bar">
                <span className="current-time">{formatTime(currentTime)}</span>
                <span className="time-sep">/</span>
                <span className="total-time">{formatTime(duration)}</span>
                {fileKey && (
                  <span
                    className={`sync-indicator${isDirty ? ' sync-dirty' : ' sync-clean'}`}
                    title={lastSyncedAt ? `最終同期: ${lastSyncedAt.toLocaleTimeString('ja-JP')}` : '未同期'}
                  >
                    ☁ {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '---'}
                  </span>
                )}
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
                  onReorder={reorderSections}
                />
              )}

              {mode === 'settings' && (
                <SettingsPanel settings={settings} onUpdate={updateSettings} />
              )}
            </div>
          )}

          {!fileLoaded && !showFileLoader && (
            <div className="app-body">
              <FileLoader onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} orgId={org?.id} />
            </div>
          )}
        </div>
      )}
    </>
  )
}
