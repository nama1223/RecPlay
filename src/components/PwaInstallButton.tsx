import { useState, useEffect } from 'react'

export function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState<boolean>(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as any).standalone === true),
  )
  const [showModal, setShowModal] = useState(false)
  const [modalContent, setModalContent] = useState({ title: '', body: '' })

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios/i.test(navigator.userAgent)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const installedHandler = () => {
      setDeferredPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  if (installed) {
    return (
      <button className="secondary-btn pwa-install-btn pwa-installed-btn" disabled>
        ✔ インストール済
      </button>
    )
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
        setInstalled(true)
      }
      return
    }
    if (isIOS) {
      setModalContent({
        title: 'iOSへのインストール方法',
        body: '<ol><li>Safari画面下部の <strong>共有ボタン（□↑）</strong> をタップ</li><li>「<strong>ホーム画面に追加</strong>」を選択</li><li>右上の「<strong>追加</strong>」をタップ</li></ol>'
      })
      setShowModal(true)
      return
    }
    setModalContent({
      title: 'インストール方法',
      body: '<ol><li><b>Chrome：</b>アドレスバー右端「⊕」または「⋮」→「アプリをインストール」</li><li><b>Edge：</b>「…」→「アプリ」→「このサイトをアプリとしてインストール」</li></ol>'
    })
    setShowModal(true)
  }

  return (
    <>
      <button className="secondary-btn pwa-install-btn" onClick={handleInstallClick}>
        📲 アプリとしてインストール
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="overflow-modal" style={{ maxWidth: 360 }}>
            <h3 className="overflow-title" style={{ color: '#c084fc', marginBottom: 8 }}>{modalContent.title}</h3>
            <div className="overflow-info" style={{ color: '#eeeeff', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: modalContent.body }} />
            <button className="primary-btn" style={{ marginTop: 12 }} onClick={() => setShowModal(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  )
}
