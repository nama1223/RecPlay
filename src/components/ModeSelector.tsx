import { AppMode } from '../types'

interface Props {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeSelector({ mode, onChange }: Props) {
  return (
    <div className="mode-selector">
      {(['play', 'edit', 'settings'] as AppMode[]).map((m) => (
        <button
          key={m}
          className={`mode-btn ${mode === m ? 'active' : ''}`}
          onClick={() => onChange(m)}
        >
          {m === 'play' ? '▶ 再生' : m === 'edit' ? '✏️ 編集' : '⚙️ 設定'}
        </button>
      ))}
    </div>
  )
}
