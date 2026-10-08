import { Button } from '@astryxdesign/core/Button'
import { useEffect, useRef, useState } from 'react'
import type QrScanner from 'qr-scanner'

export function grainCodeRecipient(value: string, origin: string) {
  const url = new URL(value)
  if (url.username || url.password || ![origin, 'https://xjdao.xyz'].includes(url.origin)) throw new Error('Invalid origin')
  const profile = url.pathname.match(/^\/profile\/([^/]+)$/)
  const recipient = profile && url.searchParams.get('send') === '1'
    ? decodeURIComponent(profile[1])
    : url.pathname === '/middle-page' ? new URLSearchParams(url.search.replace(/\+/g, '%2B')).get('receiveUser') : null
  if (!recipient || !/^(?:did:[a-z0-9]+:[a-zA-Z0-9._:%-]+|[a-zA-Z0-9][a-zA-Z0-9._@+-]{0,319})$/.test(recipient)) throw new Error('Invalid recipient')
  return recipient
}

export function GrainScannerPage({ onRead }: { onRead: (recipient: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const [cameraError, setCameraError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const accept = (value: string) => {
    if (!active.current) return
    try { const recipient = grainCodeRecipient(value, window.location.origin); active.current = false; onRead(recipient) }
    catch { setError('没认出这个码，请扫描“接收稻米”里的二维码。') }
  }
  useEffect(() => {
    active.current = true
    let cancelled = false
    let scanner: QrScanner | undefined
    void import('qr-scanner').then(async ({ default: Scanner }) => {
      if (cancelled || !video.current) return
      scanner = new Scanner(video.current, (result) => { if (!cancelled) accept(result.data) }, { preferredCamera: 'environment', maxScansPerSecond: 5 })
      await scanner.start()
    }).catch(() => {
      if (!cancelled) setCameraError('无法使用摄像头，请检查相机权限，或选择二维码图片。')
    })
    return () => { cancelled = true; active.current = false; scanner?.destroy() }
  }, [onRead])
  const readImage = async (file?: File) => {
    if (!file || busy) return
    setBusy(true); setError('')
    try {
      const { default: Scanner } = await import('qr-scanner')
      const result = await Scanner.scanImage(file, { returnDetailedScanResult: true })
      accept(result.data)
    } catch {
      if (active.current) setError('没认出这个码，请扫描“接收稻米”里的二维码。')
    } finally { if (active.current) setBusy(false) }
  }
  return <div className="page business-panel form-stack">
      <p>对准收稻米码，核对一下对方。</p>
      <video ref={video} className="grain-scanner-video" muted playsInline aria-label="收稻米码扫描画面" />
      {cameraError && <p className="muted" role="status">{cameraError}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <input ref={fileInput} type="file" accept="image/*" hidden aria-label="二维码图片" onChange={(event) => { void readImage(event.target.files?.[0]); event.target.value = '' }} />
      <div className="form-actions"><Button label="选择二维码图片" variant="secondary" isLoading={busy} isDisabled={busy} onClick={() => fileInput.current?.click()} /></div>
    </div>
}
