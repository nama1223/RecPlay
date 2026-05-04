import { useState, useCallback } from 'react'
import { ZOOM_LEVELS } from '../types'

export function useSeekBar(duration: number) {
  const [zoomIndex, setZoomIndex] = useState(ZOOM_LEVELS.length - 1)

  const initZoom = useCallback(
    (dur: number) => {
      if (dur <= 0) return
      for (let i = 0; i < ZOOM_LEVELS.length; i++) {
        const rows = Math.ceil(dur / ZOOM_LEVELS[i])
        if (rows <= 10) {
          setZoomIndex(i)
          return
        }
      }
      setZoomIndex(ZOOM_LEVELS.length - 1)
    },
    [],
  )

  const zoomIn = useCallback(() => setZoomIndex((prev) => Math.max(0, prev - 1)), [])
  const zoomOut = useCallback(
    () => setZoomIndex((prev) => Math.min(ZOOM_LEVELS.length - 1, prev + 1)),
    [],
  )

  const secondsPerRow = ZOOM_LEVELS[zoomIndex]
  const numRows = duration > 0 ? Math.ceil(duration / secondsPerRow) : 1

  return { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom }
}
