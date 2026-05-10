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

    // When not in skip-excluded mode, do a plain seek
    if (!skipExcludedRef.current || excludedZonesRef.current.length === 0) {
      audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, audio.duration || 0))
      return
    }

    // Skip delta seconds of *non-excluded* audio, jumping over excluded zones
    const zones = [...excludedZonesRef.current].sort((a, b) => a.start - b.start)
    const dur = audio.duration || 0
    let pos = audio.currentTime
    let remaining = Math.abs(delta)

    if (delta > 0) {
      for (const zone of zones) {
        if (zone.end <= pos) continue        // zone is entirely behind us
        const from = Math.max(zone.start, pos)
        if (from > pos) {
          // non-excluded gap before this zone
          const gap = from - pos
          if (gap >= remaining) { pos += remaining; remaining = 0; break }
          remaining -= gap
        }
        // jump over the excluded zone
        pos = zone.end
      }
      if (remaining > 0) pos += remaining
      pos = Math.min(pos, dur)
    } else {
      for (const zone of [...zones].reverse()) {
        if (zone.start >= pos) continue      // zone is entirely ahead of us
        const to = Math.min(zone.end, pos)
        if (to < pos) {
          // non-excluded gap between zone end and current pos
          const gap = pos - to
          if (gap >= remaining) { pos -= remaining; remaining = 0; break }
          remaining -= gap
        }
        // jump over the excluded zone (backward)
        pos = zone.start
      }
      if (remaining > 0) pos -= remaining
      pos = Math.max(pos, 0)
    }

    audio.currentTime = pos
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
