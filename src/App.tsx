import { useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSeekBar } from './hooks/useSeekBar'
import { useSettings } from './hooks/useSettings'
import { useWaveform } from './hooks/useWaveform'
import { SeekBar } from './components/SeekBar/SeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { FileLoader } from './components/FileLoader'
import { SettingsPanel } from './components/SettingsPanel'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section } from './types'
import './App.css'

export default function App() {
  const [mode, setMode] = useState<AppMode>('play')
  const [fileLoaded, setFileLoaded] = useState(false)
  const [fileName, setFileName] = useState('')
  const [showFileLoader, setShowFileLoader] = useState(false)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  const {
    audioRef, currentTime, duration, isPlaying, src,
    togglePlayPause, seek, skip, playSection,
    loadFile, loadUrl, setExcludedZones, setSkipExcluded,
  } = useAudioPlayer()

  const { sections, addSection, updateSection, deleteSection, toggleExclude, importSections } = useSections()
  const { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom } = useSeekBar(duration)
  const { settings, updateSettings } = useSettings()
  const { samples: waveformSamples } = useWaveform(src, duration)

  // URLパラメータから自動でファイルを開く
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlParam = params.get('url')
    if (urlParam) {
      loadUrl(urlParam)
      setFileName(decodeURIComponent(urlParam).split('/').pop() ?? urlParam)
      setFileLoaded(true)
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
    setFileLoaded(true)
    setShowFileLoader(false)
  }

  const handleUrlLoad = (url: string) => {
    loadUrl(url)
    setFileName(decodeURIComponent(url).split('/').pop() ?? url)
    setFileLoaded(true)
    setShowFileLoader(false)
  }

  const handleChangeFile = () => {
    if (sections.length > 0 || duration > 0) {
      if (!confirm('現在の作業内容（区間設定など）が失われます。\nJSONで保存してから変更することをお勧めします。\n\n続けますか？')) return
    }
    setShowFileLoader(true)
  }

  const handleCloseFileLoader = () => setShowFileLoader(false)

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

  return (
    <div className="app">
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />

      <header className="app-header">
        <span className="app-title">🎵 RecPlay</span>
        <ModeSelector mode={mode} onChange={setMode} />
      </header>

      {/* ファイル選択モーダル */}
      {(!fileLoaded || showFileLoader) && (
        <div className={showFileLoader ? 'modal-overlay' : 'app-body'}>
          {showFileLoader && (
            <button className="modal-close" onClick={handleCloseFileLoader}>✕ キャンセル</button>
          )}
          <FileLoader onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
        </div>
      )}

      {/* プレーヤー本体（ファイルロード済みかつモーダルが閉じている） */}
      {fileLoaded && !showFileLoader && (
        <div className="player">
          <div className="file-bar">
            <span className="file-name" title={fileName}>{fileName}</span>
            <button className="change-btn" onClick={handleChangeFile}>変更</button>
          </div>

          <div className="time-bar">
            <span className="current-time">{formatTime(currentTime)}</span>
            <span className="time-sep">/</span>
            <span className="total-time">{formatTime(duration)}</span>
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
              onToggle={togglePlayPause}
              onSkip={skip}
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
    </div>
  )
}
