import { useState } from 'react'
import { WORKER_URL } from '../config'
import { OrgInfo, getStoredOrgs, storeOrg } from '../hooks/useOrgAuth'

export type { OrgInfo }

interface Props {
  onAuth: (org: OrgInfo) => void
  onAdmin: () => void
}

export function AuthPage({ onAuth, onAdmin }: Props) {
  const [storedOrgs, setStoredOrgs] = useState<OrgInfo[]>(getStoredOrgs)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [adminPw, setAdminPw] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [adminError, setAdminError] = useState('')

  const handleAuth = async () => {
    const pw = password.trim()
    if (!pw) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${WORKER_URL}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'パスワードが違います')
      } else {
        storeOrg(data.org)
        setStoredOrgs(getStoredOrgs())
        setPassword('')
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
        <p className="file-loader-desc">みんなで編集！録音プレーヤー</p>

        {/* ログイン済み団体 */}
        {storedOrgs.length > 0 && (
          <div className="stored-orgs">
            {storedOrgs.map((org) => (
              <button
                key={org.id}
                className="org-btn"
                onClick={() => onAuth(org)}
              >
                🎵 {org.name}
              </button>
            ))}
          </div>
        )}

        {/* パスワード入力（新規ログイン） */}
        <div className="auth-form">
          {storedOrgs.length > 0 && (
            <p className="auth-new-label">別の団体に入る</p>
          )}
          <input
            className="url-input"
            type="password"
            placeholder="パスワードを入力"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            autoFocus={storedOrgs.length === 0}
          />
          {error && <p className="error-text">{error}</p>}
          <button className="primary-btn" onClick={handleAuth} disabled={loading || !password.trim()}>
            {loading ? '確認中...' : '入る'}
          </button>
        </div>

        {/* 管理者ログイン */}
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
              <button className="text-link" onClick={() => setShowAdmin(false)}>キャンセル</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
