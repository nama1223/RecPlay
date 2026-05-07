import { useEffect, useState } from 'react'
import { WORKER_URL, R2_PUBLIC_URL } from '../config'
import { OrgInfo } from './AuthPage'

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
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function authHeaders() {
  const pw = sessionStorage.getItem('adminPassword') ?? ''
  return { Authorization: `Bearer ${pw}`, 'Content-Type': 'application/json' }
}

export function AdminPage({ onLogout }: Props) {
  const [orgs, setOrgs] = useState<OrgInfo[]>([])
  const [selectedOrg, setSelectedOrg] = useState<OrgInfo | null>(null)
  const [files, setFiles] = useState<AudioFile[]>([])
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgPw, setNewOrgPw] = useState('')
  const [creating, setCreating] = useState(false)

  const loadOrgs = async () => {
    const res = await fetch(`${WORKER_URL}/admin/orgs`, { headers: authHeaders() })
    if (res.status === 401) { onLogout(); return }
    const data = await res.json()
    setOrgs(data.orgs ?? [])
  }

  const loadFiles = async (org: OrgInfo) => {
    setSelectedOrg(org)
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

  const deleteOrg = async (org: OrgInfo) => {
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
    if (selectedOrg) loadFiles(selectedOrg)
  }

  const r2Base = R2_PUBLIC_URL.replace(/\/$/, '')
  const buildShareUrl = (key: string) => {
    if (!r2Base) return ''
    const r2Url = `${r2Base}/${encodeURIComponent(key)}`
    return `${window.location.origin}${window.location.pathname.replace(/\/?$/, '/')}?url=${encodeURIComponent(r2Url)}`
  }

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

          <div className="admin-org-list">
            {orgs.map((org) => (
              <div key={org.id} className={`admin-org-item ${selectedOrg?.id === org.id ? 'active' : ''}`}>
                <button className="admin-org-name" onClick={() => loadFiles(org)}>
                  🎵 {org.name}
                </button>
                <button className="icon-btn danger" onClick={() => deleteOrg(org)} title="削除">✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* ── ファイル管理 ──────────────────────────── */}
        {selectedOrg && (
          <section className="admin-section-block">
            <h2 className="admin-section-title">📁 {selectedOrg.name} のファイル</h2>

            {files.length === 0 && <p className="no-sections">ファイルがありません</p>}

            {files.map((f) => {
              const shareUrl = buildShareUrl(f.key)
              return (
                <div key={f.key} className="admin-file-item">
                  <div className="admin-file-info">
                    <span className="admin-file-name">🎵 {f.name}</span>
                    <span className="admin-file-meta">{fmt(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('ja-JP')}</span>
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
        )}
      </div>
    </div>
  )
}
