import { useEffect, useRef } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSeekBar } from './hooks/useSeekBar'
import { useSettings } from './hooks/useSettings'
import { SeekBar } from './components/SeekBar/SeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { FileLoader } from './components/FileLoader'
import { SettingsPanel } from './components/SettingsPanel'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section } from './types'
import { useState } from 'react'
import './App.css'

export default function App() {
  const [mode, setMode] = useState<AppMode>('play')
  const [fileLoaded, setFileLoaded] = useState(false)
  const [fileName, setFileName] = useState('')

  const {
    audioRef,
    currentTime,
    duration,
    isPlaying,
    src,
    togglePlayPause,
    seek,
    skip,
    playSection,
    loadFile,
    loadUrl,
    setExcludedZones,
    setSkipExcluded,
  } = useAudioPlayer()

  const { sections, addSection, updateSection, deleteSection, toggleExclude, importSections } =
    useSections()
  const { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom } = useSeekBar(duration)
  const { settings, updateSettings } = useSettings()

  useEffect(() => {
    if (duration > 0) initZoom(duration)
  }, [duration, initZoom])

  useEffect(() => {
    const excluded = sections
      .filter((s) => s.isExcluded)
      .map((s) => ({ start: s.startTime, end: s.endTime }))
    setExcludedZones(excluded)
  }, [sections, setExcludedZones])

  useEffect(() => {
    setSkipExcluded(mode === 'play')
  }, [mode, setSkipExcluded])

  const handleFileLoad = (file: File) => {
    loadFile(file)
    setFileName(file.name)
    setFileLoaded(true)
  }

  const handleUrlLoad = (url: string) => {
    loadUrl(url)
    setFileName(url.split('/').pop() ?? url)
    setFileLoaded(true)
  }

  const handleAddSection = () => {
    const start = currentTime
    const end = Math.min(currentTime + 30, duration || currentTime + 30)
    addSection(start, end)
  }

  const handleExportJson = () => {
    const data = {
      version: 1,
      filename: fileName,
      duration,
      sections,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.replace(/\.[^.]+$/, '')}_sections.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (Array.isArray(data.sections)) {
          importSections(data.sections as Section[])
        }
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

      {!fileLoaded ? (
        <FileLoader onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
      ) : (
        <div className="player">
          <div className="file-bar">
            <span className="file-name" title={fileName}>
              {fileName}
            </span>
            <button className="change-btn" onClick={() => setFileLoaded(false)}>
              変更
            </button>
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
            onSeek={seek}
            onSectionUpdate={updateSection}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />

          {mode !== 'settings' && (
            <PlaybackControls
              isPlaying={isPlaying}
              onToggle={togglePlayPause}
              onSkip={skip}
              skipValues={settings.skipValues}
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
              onPlay={playSection}
              onUpdate={updateSection}
              onDelete={deleteSection}
              onToggleExclude={toggleExclude}
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
