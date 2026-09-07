import { useEffect, useState } from 'react'
import { WORKER_URL, R2_PUBLIC_URL } from '../config'
import { OrgInfo } from './AuthPage'

interface AdminOrgInfo extends OrgInfo {
  totalSize?: number
  storageLimitGB?: number | null
  retentionDays?: number | null
}

interface AudioFile {
  key: string
  name: string
  size: number
  uploadedAt: string
}

interface Props {
  onLogout: () => void
}

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtMB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function authHeaders() {
  const pw = sessionStorage.getItem('adminPassword') ?? ''
  return { Authorization: `Bearer ${pw}`, 'Content-Type': 'application/json' }
}

/** 削除予定日を計算 */
function calcExpiresAt(uploadedAt: string, retentionDays: number | null | undefined): Date | null {
  if (!retentionDays) return null
  const uploaded = new Date(uploadedAt)
  const expires = new Date(uploaded.getTime() + retentionDays * 24 * 60 * 60 * 1000)
  return expires
}

/** 削除予定日の表示文字列 */
function fmtExpiry(uploadedAt: string, retentionDays: number | null | undefined): string {
  const expires = calcExpiresAt(uploadedAt, retentionDays)
  if (!expires) return ''
  const now = new Date()
  const diffDays = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const dateStr = expires.toLocaleDateString('ja-JP')
  if (diffDays <= 0) return `🔴 期限切れ (${dateStr})`
  if (diffDays <= 7) return `🟡 ${dateStr} (残${diffDays}日)`
  return `${dateStr} (残${diffDays}日)`
}

export function AdminPage({ onLogout }: Props) {
  const [orgs, setOrgs] = useState<AdminOrgInfo[]>([])
  const [selectedOrg, setSelectedOrg] = useState<AdminOrgInfo | null>(null)
  const [files, setFiles] = useState<AudioFile[]>([])
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgPw, setNewOrgPw] = useState('')
  const [creating, setCreating] = useState(false)

  // 団体設定の編集用 state
  const [editLimitGB, setEditLimitGB] = useState('')
  const [editRetentionDays, setEditRetentionDays] = useState('')
  const [saving, setSaving] = useState(false)

  const loadOrgs = async () => {
    const res = await fetch(`${WORKER_URL}/admin/orgs`, { headers: authHeaders() })
    if (res.status === 401) { onLogout(); return }
    const data = await res.json()
    setOrgs(data.orgs ?? [])
  }

  const loadFiles = async (org: AdminOrgInfo) => {
    setSelectedOrg(org)
    setEditLimitGB(org.storageLimitGB != null ? String(org.storageLimitGB) : '')
    setEditRetentionDays(org.retentionDays != null ? String(org.retentionDays) : '')
    const res = await fetch(`${WORKER_URL}/files?org=${encodeURIComponent(org.id)}`)
    const data = await res.json()
    setFiles(data.files ?? [])
  }

  useEffect(() => { loadOrgs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createOrg = async () => {
    if (!newOrgName || !newOrgPw) return
    setCreating(true)
    await fetch(`${WORKER_URL}/admin/orgs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: newOrgName, password: newOrgPw }),
    })
    setNewOrgName('')
    setNewOrgPw('')
    setCreating(false)
    loadOrgs()
  }

  const deleteOrg = async (org: AdminOrgInfo) => {
    if (!confirm(`「${org.name}」を削除しますか？`)) return
    await fetch(`${WORKER_URL}/admin/orgs/${org.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (selectedOrg?.id === org.id) { setSelectedOrg(null); setFiles([]) }
    loadOrgs()
  }

  const deleteFile = async (file: AudioFile) => {
    if (!confirm(`「${file.name}」を削除しますか？（元に戻せません）`)) return
    await fetch(`${WORKER_URL}/admin/files/${encodeURIComponent(file.key)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (selectedOrg) {
      loadFiles(selectedOrg)
      loadOrgs() // 容量が変わるため再取得
    }
  }

  const saveOrgSettings = async () => {
    if (!selectedOrg) return
    setSaving(true)
    const limitGB = editLimitGB.trim() === '' ? null : parseFloat(editLimitGB)
    const retDays = editRetentionDays.trim() === '' ? null : parseInt(editRetentionDays, 10)

    await fetch(`${WORKER_URL}/admin/orgs/${selectedOrg.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        storageLimitGB: limitGB,
        retentionDays: retDays,
      }),
    })
    setSaving(false)
    // selectedOrgを即座に更新（loadOrgsは非同期でstateが遅れるため）
    setSelectedOrg({ ...selectedOrg, storageLimitGB: limitGB, retentionDays: retDays })
    // orgs一覧も再取得
    loadOrgs()
  }

  const r2Base = R2_PUBLIC_URL.replace(/\/$/, '')
  const buildShareUrl = (key: string) => {
    if (!r2Base) return ''
    const r2Url = `${r2Base}/${encodeURIComponent(key)}`
    return `${window.location.origin}${window.location.pathname.replace(/\/?$/, '/')}?url=${encodeURIComponent(r2Url)}`
  }

  // 全体の総容量を計算
  const totalAllSize = orgs.reduce((sum, o) => sum + (o.totalSize ?? 0), 0)

  return (
    <div className="admin-page">
      <header className="app-header">
        <span className="app-title">🎵 RecPlay 管理</span>
        <button className="change-btn" onClick={onLogout}>ログアウト</button>
      </header>

      <div className="admin-body">
        {/* ── 団体管理 ─────────────────────────────── */}
        <section className="admin-section-block">
          <h2 className="admin-section-title">演奏団体</h2>

          <div className="admin-create-form">
            <input
              className="url-input"
              placeholder="団体名"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
            />
            <input
              className="url-input"
              type="password"
              placeholder="パスワード"
              value={newOrgPw}
              onChange={(e) => setNewOrgPw(e.target.value)}
            />
            <button className="primary-btn" onClick={createOrg} disabled={creating || !newOrgName || !newOrgPw}>
              {creating ? '作成中...' : '+ 追加'}
            </button>
          </div>

          {/* 全体の総容量 */}
          <div className="admin-total-storage">
            📊 全体の総容量: <strong>{fmt(totalAllSize)}</strong>
          </div>

          <div className="admin-org-list">
            {orgs.map((org) => (
              <div key={org.id} className={`admin-org-item ${selectedOrg?.id === org.id ? 'active' : ''}`}>
                <button className="admin-org-name" onClick={() => loadFiles(org)}>
                  🎵 {org.name}
                  <span className="admin-org-size">
                    {fmt(org.totalSize ?? 0)} / {org.storageLimitGB ? `${org.storageLimitGB}GB` : '制限なし'} - {org.retentionDays ? `${org.retentionDays}日` : '無期限'}
                  </span>
                </button>
                <button className="icon-btn danger" onClick={() => deleteOrg(org)} title="削除">✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* ── 団体詳細 ──────────────────────────── */}
        {selectedOrg && (
          <>
            {/* ── 容量制限・保存期間の設定 ── */}
            <section className="admin-section-block">
              <h2 className="admin-section-title">⚙ {selectedOrg.name} の設定</h2>

              <div className="admin-settings-form">
                <div className="admin-setting-row">
                  <label className="admin-setting-label">容量制限 (GB)</label>
                  <input
                    className="admin-setting-input"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="制限なし"
                    value={editLimitGB}
                    onChange={(e) => setEditLimitGB(e.target.value)}
                  />
                  <span className="admin-setting-hint">
                    {editLimitGB ? `= ${(parseFloat(editLimitGB) * 1024).toFixed(0)} MB` : '未設定（無制限）'}
                  </span>
                </div>

                <div className="admin-setting-row">
                  <label className="admin-setting-label">保存期間 (日)</label>
                  <input
                    className="admin-setting-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="制限なし"
                    value={editRetentionDays}
                    onChange={(e) => setEditRetentionDays(e.target.value)}
                  />
                  <span className="admin-setting-hint">
                    {editRetentionDays ? `アップロードから${editRetentionDays}日後の0時に自動削除` : '未設定（無期限）'}
                  </span>
                </div>

                <button
                  className="primary-btn admin-save-btn"
                  onClick={saveOrgSettings}
                  disabled={saving}
                >
                  {saving ? '保存中...' : '設定を保存'}
                </button>
              </div>
            </section>

            {/* ── ファイル管理 ──────────────────────────── */}
            <section className="admin-section-block">
              <h2 className="admin-section-title">
                📁 {selectedOrg.name} のファイル
                <span className="admin-file-count">({files.length}件)</span>
              </h2>

              {files.length === 0 && <p className="no-sections">ファイルがありません</p>}

              {files.map((f) => {
                const shareUrl = buildShareUrl(f.key)
                const expiryText = fmtExpiry(f.uploadedAt, selectedOrg.retentionDays)
                return (
                  <div key={f.key} className="admin-file-item">
                    <div className="admin-file-info">
                      <span className="admin-file-name">🎵 {f.name}</span>
                      <span className="admin-file-meta">
                        {fmt(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('ja-JP')}
                        {expiryText && <span className="admin-file-expiry"> · 削除予定: {expiryText}</span>}
                      </span>
                    </div>
                    {shareUrl && (
                      <button
                        className="icon-btn"
                        title="共有URLをコピー"
                        onClick={() => { navigator.clipboard.writeText(shareUrl); alert('URLをコピーしました') }}
                      >
                        📎
                      </button>
                    )}
                    <button className="icon-btn danger" onClick={() => deleteFile(f)} title="削除">🗑</button>
                  </div>
                )
              })}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
