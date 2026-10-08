import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { IconButton } from '@astryxdesign/core/IconButton'
import { useEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from '@tanstack/react-router'
import QRCode from 'react-qr-code'
import { QrCode, ScanLine } from 'lucide-react'
import { DetailDialog } from '~/components/DetailDialog'
import { Avatar } from '~/components/Avatar'
import { integerInputError } from '~/lib/integer-input'
import type { RicePublicUser, RiceSession } from '~/lib/models'
import { readStoredSession, useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import { getTransferRecipient, sendPersonalGrains, type PersonalTransfer } from './api'
import { GrainScannerPage } from './GrainScannerPage'

export function grainReceiveLink(origin: string, did: string) {
  return `${origin}/profile/${encodeURIComponent(did)}?send=1`
}

export function PersonalGrainActions({ to }: { to?: string }) {
  const { session } = useStoredSession()
  if (!session) return null
  const own = !to || to === session.pds.did
  return <div className="personal-grain-actions">
      <Button label="送稻米" variant="ghost" href={`/me/grains/send${own ? '' : `?to=${encodeURIComponent(to)}`}`}>
        <span className="grain-action-content"><span className="grain-action-icon"><ScanLine size={22} aria-hidden="true" /></span><span>送稻米</span></span>
      </Button>
      {own && <Button label="接收稻米" variant="ghost" href="/me/grains/receive">
        <span className="grain-action-content"><span className="grain-action-icon"><QrCode size={22} aria-hidden="true" /></span><span>接收稻米</span></span>
      </Button>}
    </div>
}

export function ReceiveGrainPage() {
  const { session } = useStoredSession()
  const [copyError, setCopyError] = useState('')
  const [copied, setCopied] = useState(false)
  if (!session) return <LoginLink className="primary-link">登录后接收稻米</LoginLink>
  const link = grainReceiveLink(typeof window === 'undefined' ? '' : window.location.origin, session.pds.did)
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setCopyError('') }
    catch { setCopyError('未能复制，请手动复制下方链接。') }
  }
  return <div className="page business-panel form-stack">
        <div style={{ background: 'white', padding: 16, alignSelf: 'center' }}><QRCode value={link} size={180} title="收稻米码" /></div>
        <strong>@{session.user.handle}</strong><p>请对方扫描收稻米码，核对一下账号后送稻米。</p>
        <a href={link} style={{ overflowWrap: 'anywhere' }}>{link}</a>
        {copyError && <p className="inline-error" role="alert">{copyError}</p>}
        <div className="form-actions"><Button label={copied ? '已复制' : '复制接收链接'} variant="primary" clickAction={copy} /></div>
      </div>
}

export function SendGrainPage({ to }: { to?: string }) {
  const { session } = useStoredSession()
  if (!session) return <LoginLink className="primary-link">登录后送稻米</LoginLink>
  return <SendGrainForm key={session.token} session={session} to={to} />
}

function SendGrainForm({ session, to }: { session: RiceSession; to?: string }) {
  const navigate = useNavigate()
  const scanning = Boolean(useMatch({ from: '/me/grains_/send/scan', shouldThrow: false }))
  const [identifier, setIdentifier] = useState(to ?? '')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [recipient, setRecipient] = useState<RicePublicUser | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState<PersonalTransfer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(false)
  const lookupVersion = useRef(0)
  const autoChecked = useRef('')
  const pendingLookup = useRef<{ identifier: string; request: Promise<RicePublicUser> } | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = () => mounted.current && readStoredSession()?.token === session.token
  const amountError = amount ? integerInputError(amount, '稻米数量', 1) : null
  const changeIdentifier = (value: string) => {
    lookupVersion.current++
    autoChecked.current = ''
    setIdentifier(value); setRecipient(null); setError('')
  }
  const lookup = async (value: string): Promise<RicePublicUser | null> => {
    const query = value.trim()
    if (!query || !current()) return null
    if (recipient && query === identifier.trim()) return recipient
    const version = lookupVersion.current
    const request = pendingLookup.current?.identifier === query
      ? pendingLookup.current.request
      : getTransferRecipient({ data: { token: session.token, identifier: query } })
    pendingLookup.current = { identifier: query, request }
    setError('')
    try {
      const user = await request
      if (!current() || version !== lookupVersion.current) return null
      if (user.did === session.pds.did) throw new Error('不能送给自己。')
      setRecipient(user)
      return user
    } catch (reason) {
      if (current() && version === lookupVersion.current) {
        setRecipient(null)
        setError(reason instanceof Error ? reason.message : '没找到这位伙伴，再核对一下账号。')
      }
      return null
    } finally {
      if (pendingLookup.current?.request === request) pendingLookup.current = null
    }
  }
  const autoCheck = (value: string) => {
    const query = value.trim()
    if (!query || autoChecked.current === query) return
    autoChecked.current = query
    void lookup(query)
  }
  useEffect(() => { if (to) autoCheck(to) }, [to])
  const receiveCode = (value: string) => {
    changeIdentifier(value); autoCheck(value)
    void navigate({ to: '/me/grains/send', search: {} })
  }
  const cancelConfirmation = () => {
    if (pending.current) return
    if (uncertain) { void navigate({ to: '/me/grains' }); return }
    setConfirming(false); setError('')
  }
  const run = async () => {
    if (!current() || pending.current || !identifier.trim() || !amount || amountError || uncertain) return
    pending.current = true; setBusy(true); setError('')
    try {
      if (!confirming) {
        const user = recipient ?? await lookup(identifier)
        if (user && current()) setConfirming(true)
      } else {
        const result = await sendPersonalGrains({ data: { token: session.token, to: recipient!.id, amount: Number(amount), memo } })
        if (current()) { window.dispatchEvent(new Event('rice-changed')); setReceipt(result) }
      }
    } catch (reason) {
      if (current()) {
        setError(reason instanceof Error ? reason.message : '送稻米失败。')
        // No automatic retry: this existing transfer API has no idempotency key.
        if (confirming) setUncertain(true)
      }
    } finally { pending.current = false; if (current()) setBusy(false) }
  }
  if (scanning) return <GrainScannerPage onRead={receiveCode} />
  return <div className="page business-panel form-stack">
      {receipt ? <><strong role="status">已送给 @{receipt.to.handle} {receipt.amount} 稻米</strong><Link to="/me/grains">查看稻米记录</Link><div className="form-actions"><Button label="完成" variant="primary" onClick={() => void navigate({ to: '/me/grains' })} /></div></> : <>
        <p className="muted">个人测试稻米</p>
        <div className="grain-recipient-field">
          <TextInput label="送给谁" value={identifier} onChange={changeIdentifier} onBlur={() => autoCheck(identifier)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) autoCheck(identifier) }} description="填写手机号、完整用户名或 DID。" isDisabled={busy || confirming || uncertain} width="100%" />
          <IconButton label="扫一扫" icon={<ScanLine size={22} />} variant="ghost" isDisabled={busy || confirming || uncertain} onClick={() => void navigate({ to: '/me/grains/send/scan', search: {} })} />
        </div>
        {recipient && !confirming && <div role="status">送给：<strong>{recipient.nickname || recipient.handle}</strong>（@{recipient.handle}）</div>}
        {!confirming && error && <p className="inline-error" role="alert">{error}</p>}
        <TextInput label="送多少稻米" value={amount} onChange={setAmount} status={amountError ? { type: 'error', message: amountError } : undefined} isDisabled={busy || confirming || uncertain} width="100%" />
        <TextInput label="留言" value={memo} onChange={setMemo} isDisabled={busy || confirming || uncertain} width="100%" isOptional />
        {!confirming && <div className="form-actions"><Button label="下一步" variant="primary" isLoading={busy} isDisabled={busy || !identifier.trim() || !amount || !!amountError} clickAction={run} /></div>}
      </>}
    {confirming && recipient && !receipt && <DetailDialog title="确认送稻米" className="post-dialog business-dialog compose-close-dialog" onClose={cancelConfirmation}>
      <div className="business-panel form-stack">
        <section><Avatar name={recipient.nickname || recipient.handle} src={recipient.avatar?.url} /><strong>{recipient.nickname || recipient.handle}</strong><p>@{recipient.handle}</p><p>确认送出 {amount} 稻米？</p></section>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {uncertain ? <p role="alert">送出的结果尚未确认，请先<Link to="/me/grains">查看稻米记录</Link>，确认未扣除稻米后再重新送出。</p> : <div className="form-actions">
          <Button label="返回修改" variant="secondary" isDisabled={busy} onClick={cancelConfirmation} />
          <Button label="确认送出" variant="primary" isLoading={busy} isDisabled={busy} clickAction={run} />
        </div>}
      </div>
    </DetailDialog>}
  </div>
}
