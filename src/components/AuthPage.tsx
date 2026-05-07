import { useEffect, useState } from 'react'
import { WORKER_URL } from '../config'

export interface OrgInfo {
  id: string
  name: string
}

interface Props {
  onAuth: (org: OrgInfo) => void
  onAdmin: () => void
}

export function AuthPage({ onAuth, onAdmin }: Props) {
  const [orgs, setOrgs] = useState<OrgInfo[]>([])
  const [selectedOrg, setSelectedOrg] = useState<OrgInfo | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [adminPw, setAdminPw] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [adminError, setAdminError] = useState('')

  useEffect(() => {
    fetch(`${WORKER_URL}/orgs`)
      .then((r) => r.json())
      .then((d) => setOrgs(d.orgs ?? []))
      .catch(() => {})
  }, [])

  const handleAuth = async () => {
    if (!selectedOrg || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${WORKER_URL}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: selectedOrg.id, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'ログイン失敗')
      } else {
        onAuth(data.org)
      }
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const handleAdminLogin = async () => {
    setAdminError('')
    // Verify by hitting admin orgs endpoint
    const res = await fetch(`${WORKER_URL}/admin/orgs`, {
      headers: { Authorization: `Bearer ${adminPw}` },
    })
    if (res.ok) {
      sessionStorage.setItem('adminPassword', adminPw)
      onAdmin()
    } else {
      setAdminError('パスワードが違います')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="file-loader-logo">🎵</div>
        <div className="file-loader-title">RecPlay</div>
        <p className="file-loader-desc">演奏団体を選択してください</p>

        {orgs.length === 0 && (
          <p className="hint-text">団体情報を読み込み中...</p>
        )}

        <div className="org-list">
          {orgs.map((org) => (
            <button
              key={org.id}
              className={`org-btn ${selectedOrg?.id === org.id ? 'active' : ''}`}
              onClick={() => { setSelectedOrg(org); setPassword(''); setError('') }}
            >
              {org.name}
            </button>
          ))}
        </div>

        {selectedOrg && (
          <div className="auth-form">
            <p className="auth-org-name">🎵 {selectedOrg.name}</p>
            <input
              className="url-input"
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              autoFocus
            />
            {error && <p className="error-text">{error}</p>}
            <button className="primary-btn" onClick={handleAuth} disabled={loading || !password}>
              {loading ? '確認中...' : 'ログイン'}
            </button>
          </div>
        )}

        <div className="admin-section">
          {!showAdmin ? (
            <button className="text-link" onClick={() => setShowAdmin(true)}>
              管理者ログイン
            </button>
          ) : (
            <div className="auth-form">
              <input
                className="url-input"
                type="password"
                placeholder="管理者パスワード"
                value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                autoFocus
              />
              {adminError && <p className="error-text">{adminError}</p>}
              <button className="primary-btn" onClick={handleAdminLogin} disabled={!adminPw}>
                管理者として入る
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
