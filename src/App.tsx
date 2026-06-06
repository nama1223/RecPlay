import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSeekBar } from './hooks/useSeekBar'
import { useSettings } from './hooks/useSettings'
import { useWaveform } from './hooks/useWaveform'
import { useSectionSync } from './hooks/useSectionSync'
import { OrgInfo, getStoredOrgs, storeOrg } from './hooks/useOrgAuth'
import { computeWaveform, serializeWaveform, getWaveformResumeInfo, clearWaveformResume } from './utils/waveformCompute'
import { normalizeFile, NormPhase, NORMALIZE_TARGET_LEVEL, restoreSampleRate44to48, normalizeAllSections } from './utils/normalize'
import { SeekBar } from './components/SeekBar/SeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthPage } from './components/AuthPage'
import { FileListPage } from './components/FileListPage'
import { AdminPage } from './components/AdminPage'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section, ZOOM_LEVELS } from './types'
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
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  // Incremented on every file selection (even same file) to force useSectionSync re-fetch
  const [fileLoadCounter, setFileLoadCounter] = useState(0)
  // { id, seq } — seq increments each tap so repeated taps on the same label still trigger scroll
  const [scrollTarget, setScrollTarget] = useState<{ id: string; seq: number } | null>(null)

  const {
    audioRef, currentTime, duration, isPlaying, src,
    togglePlayPause, seek, skip, playSection,
    loadFile, loadUrl, setExcludedZones, setSkipExcluded,
    playbackRate, changePlaybackRate,
  } = useAudioPlayer()

  const { sections, addSection, updateSection, deleteSection, toggleExclude, importSections, reorderSections, undo, redo, undoCount, redoCount } = useSections()
  const { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom } = useSeekBar(duration)
  const { settings, updateSettings } = useSettings()
  const { samples: waveformSamples, setSamples: setWaveformSamples, hasStored: waveformStored, peakLevel: waveformPeakLevel, setPeakLevel: setWaveformPeakLevel } = useWaveform(src, duration, fileKey)
  const [waveformGenerating, setWaveformGenerating] = useState(false)
  const [waveformGenPct, setWaveformGenPct] = useState(0)
  const [waveMenuOpen, setWaveMenuOpen] = useState(false)
  const waveMenuRef = useRef<HTMLDivElement>(null)
  const [normalizing, setNormalizing] = useState(false)
  const [normPct, setNormPct] = useState(0)
  const [normPhase, setNormPhase] = useState<NormPhase>('encode')
  const [normAllActive, setNormAllActive] = useState(false)
  const onRemoteUpdate = useCallback((secs: Section[]) => importSections(secs), [importSections])
  const { lastSyncedAt, isDirty } = useSectionSync(fileKey, fileLoadCounter, mode, sections, onRemoteUpdate)

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

  // ── Space キーで再生/停止 ────────────────────────────────────────────────
  const togglePlayPauseRef = useRef(togglePlayPause)
  useEffect(() => { togglePlayPauseRef.current = togglePlayPause }, [togglePlayPause])

  useEffect(() => {
    if (screen !== 'player') return
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      e.preventDefault()
      togglePlayPauseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [screen])

  useEffect(() => {
    const excluded = sections.filter((s) => s.isExcluded).map((s) => ({ start: s.startTime, end: s.endTime }))
    setExcludedZones(excluded)
  }, [sections, setExcludedZones])

  useEffect(() => {
    setSkipExcluded(mode === 'play')
  }, [mode, setSkipExcluded])

  const handleFileSelect = (url: string, key: string, name: string) => {
    loadUrl(url)
    setFileName(name)
    setFileKey(key)
    setFileLoaded(true)
    setScreen('player')
    setFileLoadCounter((c) => c + 1) // force useSectionSync re-fetch (even for same file)
    importSections([])               // clear UI immediately; sync is blocked until remote loads
  }

  // リネーム完了時：プレーヤーで開いているファイルが対象ならsrcとfileKeyを更新
  const handleRename = useCallback((oldKey: string, newKey: string, newName: string) => {
    if (fileKey === oldKey) {
      setFileKey(newKey)
      setFileName(newName)
      loadUrl(buildWorkerAudioUrl(newKey))
    }
  }, [fileKey, loadUrl])

  const handleSectionLabelClick = (id: string) => {
    setActiveSectionId(id)
    setScrollTarget((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }))
  }

  const handleAddSection = () => {
    const start = currentTime
    const end = Math.min(currentTime + 30, duration || currentTime + 30)
    const id = addSection(start, end)
    setActiveSectionId(id)
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

  const handleGenerateWaveform = async () => {
    if (!src || !fileKey || duration <= 0) return

    const resumeKey = `wf-${fileKey}`
    const numChunks = Math.ceil(duration / 300) // 5-min chunks
    const resumeInfo = getWaveformResumeInfo(resumeKey)

    // Confirm / offer resume
    if (resumeInfo) {
      const choice = confirm(
        `前回の波形生成が ${resumeInfo.pct}% で中断されています。\n` +
        `「OK」で続きから再開、「キャンセル」で最初からやり直します。`
      )
      if (!choice) clearWaveformResume(resumeKey)
    } else if (waveformStored) {
      if (!confirm('波形データはすでに生成済みです。再生成しますか？')) return
      clearWaveformResume(resumeKey)
    } else {
      const estMin = Math.ceil(numChunks * 8 / 60) // ~8s per chunk on average
      if (!confirm(
        `波形を生成します（${numChunks}チャンク、目安 ${estMin} 分）。\n` +
        `途中で中断しても次回「🎵」を押すと再開できます。\n\n続けますか？`
      )) return
    }

    setWaveformGenerating(true)
    setWaveformGenPct(resumeInfo?.pct ?? 0)
    try {
      const { samples, peakLevel } = await computeWaveform(
        src,
        duration,
        (pct, displayBins) => {
          setWaveformGenPct(pct)
          setWaveformSamples(displayBins) // live waveform display per chunk
        },
        resumeKey,
      )
      setWaveformSamples(samples)
      setWaveformPeakLevel(peakLevel > 0 ? peakLevel : null)
      // Save completed waveform (including peakLevel) to Worker
      const body = JSON.stringify(serializeWaveform(samples, duration, peakLevel))
      await fetch(`${WORKER_URL}/waveform?file=${encodeURIComponent(fileKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    } catch (e) {
      alert(`波形生成に失敗しました: ${e}`)
    } finally {
      setWaveformGenerating(false)
    }
  }

  /** Re-save waveform to Worker with an updated peakLevel (after normalization). */
  const saveWaveformPeakToWorker = useCallback(async (peak: number) => {
    if (!fileKey || !waveformSamples) return
    const body = JSON.stringify(serializeWaveform(waveformSamples, duration, peak))
    await fetch(`${WORKER_URL}/waveform?file=${encodeURIComponent(fileKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {}) // best-effort
  }, [fileKey, waveformSamples, duration])

  const handleNormalizeFile = async () => {
    if (!src || !fileKey || !waveformPeakLevel || duration <= 0) return
    setWaveMenuOpen(false)

    // Compute gain and show preview
    const rawGain = NORMALIZE_TARGET_LEVEL / waveformPeakLevel
    const gain    = Math.min(rawGain, 20)
    const gainDb  = 20 * Math.log10(gain)
    const peakDb  = 20 * Math.log10(waveformPeakLevel)
    const isCapped = rawGain > 20
    const alreadyNorm = gainDb < 0.1

    let gainLine: string
    if (alreadyNorm) {
      gainLine = `→ すでにノーマライズ済みです（変化なし）`
    } else if (isCapped) {
      gainLine = `→ 音量が非常に小さいため上限 +26.0 dB（20倍）を適用します`
    } else {
      gainLine = `→ +${gainDb.toFixed(1)} dB（${gain.toFixed(2)}倍）アップします`
    }

    const estMin = Math.ceil(duration / 300 * 8 / 60)
    if (!confirm(
      `ファイル全体をノーマライズして R2 を上書きします。\n\n` +
      `現在のピーク: ${peakDb.toFixed(1)} dBFS\n${gainLine}\n\n` +
      `目安: ${estMin} 分程度\n続けますか？`
    )) return

    setNormalizing(true)
    setNormPct(0)
    try {
      await normalizeFile(src, duration, fileKey, waveformPeakLevel, (pct, phase) => {
        setNormPct(pct)
        setNormPhase(phase)
      })
      // Update peakLevel to TARGET_LEVEL so re-normalize doesn't over-amplify
      setWaveformPeakLevel(NORMALIZE_TARGET_LEVEL)
      await saveWaveformPeakToWorker(NORMALIZE_TARGET_LEVEL)
      // Reload audio (cache-bust)
      const bust = src.includes('?') ? `${src}&_r=${Date.now()}` : `${src}?_r=${Date.now()}`
      loadUrl(bust)
    } catch (e) {
      alert(`ノーマライズに失敗しました: ${e}`)
    } finally {
      setNormalizing(false)
    }
  }

  const handleRestore44to48 = async () => {
    if (!src || !fileKey || duration <= 0) return
    setWaveMenuOpen(false)

    const RATIO = 44100 / 48000  // ≈ 0.9188
    const newDur = Math.round(duration * RATIO)
    const fmt = (s: number) => `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${Math.floor(s % 60)}s`

    if (!confirm(
      `44.1kHz誤エンコードされたファイルを48kHzに修復します。\n\n` +
      `現在の長さ: ${fmt(duration)}\n` +
      `修復後の長さ: ${fmt(newDur)}（約 ${(RATIO * 100).toFixed(1)}% に縮小）\n\n` +
      `区間の開始・終了位置も同じ比率で縮小されます。\n` +
      `※ すでに正しい48kHzのファイルに実行すると壊れます。\n\n続けますか？`
    )) return

    setNormalizing(true)
    setNormPct(0)
    setNormPhase('encode')
    try {
      await restoreSampleRate44to48(src, duration, fileKey, (pct, phase) => {
        setNormPct(pct)
        setNormPhase(phase)
      })
      // Scale all section times by 44100/48000
      importSections(sections.map((s) => ({
        ...s,
        startTime: Math.round(s.startTime * RATIO * 1000) / 1000,
        endTime:   Math.round(s.endTime   * RATIO * 1000) / 1000,
      })))
      // Reload audio (cache-bust)
      const bust = src.includes('?') ? `${src}&_r=${Date.now()}` : `${src}?_r=${Date.now()}`
      loadUrl(bust)
    } catch (e) {
      alert(`修復に失敗しました: ${e}`)
    } finally {
      setNormalizing(false)
    }
  }

  /** Called by SectionItem after section normalize completes. */
  const handleSectionNormalized = useCallback(() => {
    setWaveformPeakLevel(NORMALIZE_TARGET_LEVEL)
    saveWaveformPeakToWorker(NORMALIZE_TARGET_LEVEL)
    // Clear stale waveform — amplitude changed; user can regenerate with 🎵
    setWaveformSamples(null)
    // Reload audio (cache-bust)
    if (src) {
      const bust = src.includes('?') ? `${src}&_r=${Date.now()}` : `${src}?_r=${Date.now()}`
      loadUrl(bust)
    }
  }, [saveWaveformPeakToWorker, src, loadUrl, setWaveformSamples])

  /** Called from SectionList's "normalize all play sections" button. */
  const handleNormalizeAll = useCallback(async () => {
    if (!src || !fileKey || duration <= 0) return
    const playSections = sections.filter((s) => !s.isExcluded)
    if (playSections.length === 0) { alert('再生区間がありません'); return }
    if (!confirm(
      `全ての再生区間（${playSections.length} 件）のピークを個別に検出し、\n` +
      `1回のエンコードでまとめてノーマライズします。\n\n続けますか？`
    )) return

    setNormAllActive(true)
    setNormPct(0)
    setNormPhase('scan')
    setNormalizing(true)
    try {
      await normalizeAllSections(src, duration, fileKey, sections, (pct, phase) => {
        setNormPct(pct)
        setNormPhase(phase)
      })
      setWaveformPeakLevel(NORMALIZE_TARGET_LEVEL)
      await saveWaveformPeakToWorker(NORMALIZE_TARGET_LEVEL)
      // Clear stale waveform — amplitudes changed; user can regenerate with 🎵
      setWaveformSamples(null)
      // Reload audio (cache-bust)
      const bust = src.includes('?') ? `${src}&_r=${Date.now()}` : `${src}?_r=${Date.now()}`
      loadUrl(bust)
    } catch (e) {
      alert(`ノーマライズに失敗しました: ${e}`)
    } finally {
      setNormAllActive(false)
      setNormalizing(false)
    }
  }, [src, fileKey, duration, sections, saveWaveformPeakToWorker, setWaveformSamples, loadUrl])

  // Close wave menu when clicking outside
  useEffect(() => {
    if (!waveMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (waveMenuRef.current && !waveMenuRef.current.contains(e.target as Node)) {
        setWaveMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [waveMenuOpen])

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
          onRename={handleRename}
          onLogout={handleLogout}
        />
      )}

      {screen === 'player' && (
        <div className="app">
          <header className="app-header">
            <span className="app-title">
              <div className="wave-menu-wrapper" ref={waveMenuRef}>
                <button
                  className={`waveform-gen-btn${waveformGenerating || normalizing ? ' generating' : ''}`}
                  onClick={fileKey && !waveformGenerating && !normalizing ? () => setWaveMenuOpen((v) => !v) : undefined}
                  title={fileKey ? '波形・ノーマライズメニュー' : '（ファイル未選択）'}
                  disabled={!fileKey || waveformGenerating || normalizing}
                >≡</button>
                {waveMenuOpen && (
                  <div className="wave-menu">
                    {fileKey && (
                      <button
                        className="wave-menu-item"
                        onClick={() => {
                          const url = `${location.origin}${location.pathname}?url=${encodeURIComponent(buildWorkerAudioUrl(fileKey))}`
                          navigator.clipboard.writeText(url).then(() => alert('URLをコピーしました'))
                          setWaveMenuOpen(false)
                        }}
                      >
                        🔗 ファイルURL共有
                      </button>
                    )}
                    <button className="wave-menu-item" onClick={handleGenerateWaveform}>
                      📊 波形生成{waveformStored ? '（再生成）' : ''}
                    </button>
                    <button
                      className="wave-menu-item"
                      onClick={handleNormalizeFile}
                      disabled={!waveformPeakLevel}
                      title={!waveformPeakLevel ? '先に波形を生成してください' : undefined}
                    >
                      🔊 ノーマライズ（全体）
                    </button>
                    <button
                      className="wave-menu-item"
                      onClick={handleRestore44to48}
                      title="44.1kHz誤エンコードを48kHzに修復（一時機能）"
                    >
                      🔧 44.1→48kHz修復
                    </button>
                  </div>
                )}
              </div>
              {org
                ? <button className="org-name-link" onClick={() => setScreen('files')} title="ファイル一覧へ">{org.name}</button>
                : 'RecPlay'
              }
              {waveformGenerating && <span className="waveform-gen-status"> 波形生成中... {waveformGenPct}%</span>}
              {normalizing && (
                <span className="waveform-gen-status">
                  {normPhase === 'scan' ? ' ピーク検出中...' : normPhase === 'upload' ? ' アップロード中...' : ' エンコード中...'} {normPct}%
                </span>
              )}
            </span>
            <ModeSelector mode={mode} onChange={setMode} />
          </header>

          {fileLoaded && (
            <div className="player">
              {/* file name (left) + time display (right) */}
              <div className="file-bar">
                <span className="file-name" title={fileName}>{fileName}</span>
                <div className="time-display">
                  <span className="current-time">{formatTime(currentTime)}</span>
                  <span className="time-sep">/</span>
                  <span className="total-time">{formatTime(duration)}</span>
                  {fileKey && (
                    <span
                      className={`sync-indicator${isDirty ? ' sync-dirty' : ' sync-clean'}`}
                      title={lastSyncedAt ? `最終同期: ${lastSyncedAt.toLocaleTimeString('ja-JP')}` : '未同期'}
                    >
                      ☁ {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                  )}
                </div>
              </div>

              {/* zoom controls — centered, own row */}
              <div className="zoom-row">
                <button className="zoom-btn-sm" onClick={zoomOut} disabled={zoomIndex === ZOOM_LEVELS.length - 1} title="ズームアウト">−</button>
                <span className="zoom-label-sm">{secondsPerRow >= 60 ? `${secondsPerRow / 60}分/段` : `${secondsPerRow}秒/段`}</span>
                <button className="zoom-btn-sm" onClick={zoomIn} disabled={zoomIndex === 0} title="ズームイン">＋</button>
              </div>

              <SeekBar
                currentTime={currentTime}
                duration={duration}
                secondsPerRow={secondsPerRow}
                numRows={numRows}
                sections={sections}
                mode={mode}
                waveformSamples={waveformSamples}
                activeSectionId={activeSectionId}
                onSeek={seek}
                onSectionUpdate={updateSection}
                onSectionLabelClick={handleSectionLabelClick}
              />

              {mode !== 'settings' && (
                <PlaybackControls
                  isPlaying={isPlaying}
                  mode={mode}
                  currentTime={currentTime}
                  sections={sections}
                  playbackRate={playbackRate}
                  onToggle={togglePlayPause}
                  onSkip={skip}
                  onSeek={seek}
                  onPlaybackRateChange={changePlaybackRate}
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
                  scrollTarget={scrollTarget}
                  hasWaveform={waveformStored && !!waveformPeakLevel}
                  onAddSection={handleAddSection}
                  onUndo={undo}
                  onRedo={redo}
                  undoCount={undoCount}
                  redoCount={redoCount}
                  onReorder={reorderSections}
                  onSectionNormalized={handleSectionNormalized}
                  onNormalizeAll={fileKey ? handleNormalizeAll : undefined}
                  normalizeAllActive={normAllActive}
                />
              )}

              {mode === 'settings' && (
                <SettingsPanel settings={settings} onUpdate={updateSettings} />
              )}
            </div>
          )}

        </div>
      )}
    </>
  )
}
