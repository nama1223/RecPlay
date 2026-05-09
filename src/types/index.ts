export const ZOOM_LEVELS = [10, 20, 40, 80, 150, 300, 600, 1200] as const
export type ZoomLevel = typeof ZOOM_LEVELS[number]

export type AppMode = 'play' | 'edit' | 'settings'

export interface Section {
  id: string
  label: string
  startTime: number
  endTime: number
  isExcluded: boolean
  color: string
}

export interface ExcludedZone {
  start: number
  end: number
}

export interface AppSettings {
  skipValues: number[]
  editAdjustValues: number[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  skipValues: [-60, -20, -5, 5, 20, 60],
  editAdjustValues: [-5, -1, -0.5, 0.5, 1, 5],
}

export const SECTION_COLORS = [
  '#4A90E2',
  '#7ED321',
  '#F5A623',
  '#9013FE',
  '#50E3C2',
  '#E25C4A',
  '#E24AB0',
  '#4AE2B5',
]
