import { useState } from 'react'
import { AppSettings, DEFAULT_SETTINGS } from '../types'

interface Props {
  settings: AppSettings
  onUpdate: (updates: Partial<AppSettings>) => void
}

function ValuesEditor({
  label,
  values,
  onChange,
}: {
  label: string
  values: number[]
  onChange: (vals: number[]) => void
}) {
  const [raw, setRaw] = useState(values.join(', '))
  const [error, setError] = useState('')

  const apply = () => {
    const parsed = raw
      .split(/[,\s]+/)
      .map((v) => parseFloat(v.trim()))
      .filter((v) => !isNaN(v))
    if (parsed.length === 0) {
      setError('有効な数値を入力してください')
      return
    }
    setError('')
    onChange(parsed)
  }

  return (
    <div className="settings-group">
      <label className="settings-label">{label}</label>
      <input
        className="settings-input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder="例: -60, -20, -5, 5, 20, 60"
      />
      {error && <span className="settings-error">{error}</span>}
      <span className="settings-hint">カンマ区切りで入力。マイナスは戻り方向。</span>
    </div>
  )
}

export function SettingsPanel({ settings, onUpdate }: Props) {
  return (
    <div className="settings-panel">
      <h3 className="settings-title">設定</h3>

      <ValuesEditor
        label="スキップボタンの秒数（再生モード）"
        values={settings.skipValues}
        onChange={(vals) => onUpdate({ skipValues: vals })}
      />

      <ValuesEditor
        label="微調整ボタンの秒数（編集モード）"
        values={settings.editAdjustValues}
        onChange={(vals) => onUpdate({ editAdjustValues: vals })}
      />

      <button
        className="reset-btn"
        onClick={() =>
          onUpdate({
            skipValues: [...DEFAULT_SETTINGS.skipValues],
            editAdjustValues: [...DEFAULT_SETTINGS.editAdjustValues],
          })
        }
      >
        デフォルトに戻す
      </button>

      <p className="settings-hint" style={{ marginTop: 16 }}>
        設定はこの端末のLocalStorageに保存されます。
      </p>
    </div>
  )
}
