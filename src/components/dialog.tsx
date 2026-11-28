import { useEffect, useState } from 'react'

type ConfirmOptions = { confirmLabel?: string; cancelLabel?: string }
type ConfirmRequest = {
  message: string
  confirmLabel: string
  cancelLabel: string
  resolve: (confirmed: boolean) => void
}
type Toast = { id: number; message: string }

type DialogHandler = {
  toast: (message: string) => void
  ask: (request: ConfirmRequest) => void
}

let dialogHandler: DialogHandler | null = null
let nextToastId = 0

export function showToast(message: string): void {
  dialogHandler?.toast(message)
}

export function confirmDialog(message: string, options?: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dialogHandler) {
      resolve(false)
      return
    }
    dialogHandler.ask({
      message,
      confirmLabel: options?.confirmLabel ?? 'OK',
      cancelLabel: options?.cancelLabel ?? 'キャンセル',
      resolve,
    })
  })
}

export function DialogHost() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirms, setConfirms] = useState<ConfirmRequest[]>([])
  const activeConfirm = confirms[0]

  useEffect(() => {
    const handler: DialogHandler = {
      toast: (message) => setToasts((items) => [...items, { id: ++nextToastId, message }]),
      ask: (request) => setConfirms((items) => [...items, request]),
    }
    dialogHandler = handler
    return () => {
      if (dialogHandler === handler) dialogHandler = null
      setConfirms((items) => {
        items.forEach((item) => item.resolve(false))
        return []
      })
    }
  }, [])

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map(({ id }) => window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id))
    }, 4000))
    return () => timers.forEach(window.clearTimeout)
  }, [toasts])

  const settleConfirm = (confirmed: boolean) => {
    if (!activeConfirm) return
    activeConfirm.resolve(confirmed)
    setConfirms((items) => items.slice(1))
  }

  return (
    <>
      {toasts.length > 0 && (
        <div className="toast-container" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <button
              className="app-toast"
              key={toast.id}
              onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}
            >
              {toast.message}
            </button>
          ))}
        </div>
      )}
      {activeConfirm && (
        <div
          className="modal-overlay dialog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) settleConfirm(false)
          }}
        >
          <div className="overflow-modal dialog-modal" role="dialog" aria-modal="true">
            <p className="dialog-message">{activeConfirm.message}</p>
            <div className="dialog-actions">
              <button className="dialog-cancel" onClick={() => settleConfirm(false)}>
                {activeConfirm.cancelLabel}
              </button>
              <button className="dialog-confirm" onClick={() => settleConfirm(true)}>
                {activeConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
