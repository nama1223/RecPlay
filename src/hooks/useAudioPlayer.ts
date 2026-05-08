import { useRef, useState, useCallback, useEffect } from 'react'
import { ExcludedZone } from '../types'

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [src, setSrc] = useState<string | null>(null)

  const sectionEndRef = useRef<number | null>(null)
  const excludedZonesRef = useRef<ExcludedZone[]>([])
  const skipExcludedRef = useRef(false)

  useEffect(() => {
    const audio = audioRef.current
    console.log('[useAudioPlayer] effect ran, audioRef.current =', audio)
    if (!audio) return

    const onTimeUpdate = () => {
      const t = audio.currentTime
      setCurrentTime(t)

      if (sectionEndRef.current !== null && t >= sectionEndRef.current) {
        audio.pause()
        sectionEndRef.current = null
        return
      }

      if (skipExcludedRef.current) {
        for (const zone of excludedZonesRef.current) {
          if (t >= zone.start && t < zone.end) {
            audio.currentTime = zone.end
            return
          }
        }
      }
    }

    const onDurationChange = () => {
      console.log('[useAudioPlayer] durationchange fired, audio.duration =', audio.duration, 'isFinite =', isFinite(audio.duration))
      if (isFinite(audio.duration)) setDuration(audio.duration)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => {
      setIsPlaying(false)
    }
    const onEnded = () => {
      setIsPlaying(false)
      sectionEndRef.current = null
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onDurationChange)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onDurationChange)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play()
    else audio.pause()
  }, [])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || 0))
  }, [])

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, audio.duration || 0))
  }, [])

  const playSection = useCallback((startTime: number, endTime: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = startTime
    sectionEndRef.current = endTime
    audio.play()
  }, [])

  const loadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    setSrc((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return url
    })
    setCurrentTime(0)
    setDuration(0)
  }, [])

  const loadUrl = useCallback((url: string) => {
    console.log('[useAudioPlayer] loadUrl called, url =', url)
    setSrc(url)
    setCurrentTime(0)
    setDuration(0)
    // 同じURLを再度開いたときReactがsrc属性を更新しないケースに対応
    const audio = audioRef.current
    if (audio) {
      audio.src = url
      audio.load()
    }
  }, [])

  const setExcludedZones = useCallback((zones: ExcludedZone[]) => {
    excludedZonesRef.current = zones
  }, [])

  const setSkipExcluded = useCallback((val: boolean) => {
    skipExcludedRef.current = val
  }, [])

  return {
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
  }
}
