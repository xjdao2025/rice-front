import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import QRCode from 'react-qr-code'
import { Route } from '~/routes/me.points.$pointId'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { LoginLink } from '../session/LoginLink'
import { useStoredSession } from '../session/session'
import { findTransferRecipients } from '../grains/api'
import { GrainScannerPage } from '../grains/GrainScannerPage'
import { formatTimestamp } from '~/lib/format'
import { errorMessage } from '~/lib/util'
import { getPointHistory, getPointWallets, sendPoints, type PointEntry, type PointWallet } from './wallet-api'

export function PointWalletPage() {
  const { session, isReady } = useStoredSession()
  const { pointId } = Route.useParams()
  const { mode, to } = Route.useSearch()
  if (!isReady) return <p role="status">正在加载…</p>
  if (!session) return <LoginLink className="primary-link">登录后使用积分</LoginLink>
  return <WalletContent key={session.token + pointId + mode} token={session.token} pointId={pointId} mode={mode} initialTo={to} handle={session.user.handle} />
}

function WalletContent({ token, pointId, mode, initialTo, handle }: { token: string; pointId: string; mode: string; initialTo: string; handle: string }) {
  const [wallet, setWallet] = useState<PointWallet>()
  const [entries, setEntries] = useState<PointEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [to, setTo] = useState(initialTo)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [sent, setSent] = useState('')
  const [scan, setScan] = useState(false)
  const [copied, setCopied] = useState(false)
  const sending = useRef(false)
  const request = useRef<{ payload: string; id: string } | undefined>(undefined)
  const navigate = Route.useNavigate()
  const read = useCallback((recipient: string) => { setTo(recipient); setScan(false); setConfirm(false) }, [])
  const parse = useCallback((value: string, origin: string) => {
    const url = new URL(value)
    if (url.origin !== origin || url.username || url.password || url.pathname !== '/me/points/' + pointId || url.searchParams.get('mode') !== 'send') throw new Error('Invalid point QR')
    const recipient = url.searchParams.get('to')
    if (!recipient || recipient.length > 320) throw new Error('Invalid recipient')
    return recipient
  }, [pointId])

  useEffect(() => {
    let active = true
    void Promise.all([getPointWallets({ data: { token } }), mode === 'history' ? getPointHistory({ data: { token, pointId } }) : undefined]).then(([wallets, history]) => {
      if (!active) return
      setWallet(wallets.find(w => w.point_id === pointId))
      if (history) { setEntries(history.data); setCursor(history.meta.next_cursor) }
    }).catch(e => { if (active) setError(errorMessage(e, '加载失败')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, pointId, mode])

  async function review() {
    setLoading(true); setError('')
    try {
      const result = await findTransferRecipients({ data: { token, identifier: to.trim() } })
      if (!result.exact || result.users.length !== 1) throw new Error('请填写完整账号或扫描对方的接收码。')
      setTo(result.users[0].handle)
      setConfirm(true)
    } catch (e) { setError(errorMessage(e, '无法确认收款账号')) }
    finally { setLoading(false) }
  }

  async function submit() {
    if (sending.current) return
    sending.current = true
    setLoading(true); setError('')
    const payload = JSON.stringify([to.trim(), amount, note])
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() }
    try {
      const result = await sendPoints({ data: { token, pointId, to: to.trim(), amount, note, requestId: request.current.id } })
      setSent(`已送给 @${result.to.handle} ${result.amount} ${wallet?.name ?? '积分'}`)
      setConfirm(false)
      window.dispatchEvent(new Event('rice-changed'))
    } catch (e) { setError(errorMessage(e, '暂未确认送出结果，请先查看积分记录，再使用相同内容重试。')) }
    finally { sending.current = false; setLoading(false) }
  }

  const validAmount = /^[1-9][0-9]{0,18}$/.test(amount) && BigInt(amount) <= 9223372036854775807n
  const link = typeof window === 'undefined' ? '' : window.location.origin + '/me/points/' + pointId + '?mode=send&to=' + encodeURIComponent(handle)
  return <div className="page business-panel form-stack">
    <h1>{wallet?.name ?? '我的积分'}</h1>
    <nav className="filter-buttons">
      {(['history', 'send', 'receive'] as const).map(value => <Button key={value} label={{ history: '积分记录', send: '送积分', receive: '接收积分' }[value]} variant="ghost" aria-pressed={mode === value} onClick={() => void navigate({ search: { mode: value, to: '' } })} />)}
    </nav>
    {wallet && <section className="grain-card"><div className="grain-balance-row"><strong>{(BigInt(wallet.available) + BigInt(wallet.held)).toLocaleString('zh-CN')}</strong></div><div className="grain-metrics"><div><b>{BigInt(wallet.available).toLocaleString('zh-CN')}</b><span>可用</span></div><div><b>{BigInt(wallet.held).toLocaleString('zh-CN')}</b><span>冻结积分</span></div><div><b>{BigInt(wallet.earned).toLocaleString('zh-CN')}</b><span>累计获得</span></div></div></section>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">正在加载…</p>}
    {mode === 'receive' && <>
      <div className="grain-receive-card"><div className="grain-receive-qr">{link && <QRCode value={link} size={180} title="接收积分码" />}</div><strong>@{handle}</strong><span>{wallet?.name}</span></div>
      <p>请对方扫描二维码，核对账号和积分后送出。</p>
      <a href={link} style={{ overflowWrap: 'anywhere' }}>{link}</a>
      <Button label={copied ? '已复制' : '复制接收链接'} variant="primary" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setError('未能复制，请手动复制链接。')) }} />
    </>}
    {mode === 'send' && (sent ? <><p role="status">{sent}</p><Button label="查看积分记录" variant="primary" onClick={() => void navigate({ search: { mode: 'history', to: '' } })} /></> : <>
      {scan ? <GrainScannerPage onRead={read} parseCode={parse} assetName="积分" /> : <Button label="扫码接收积分码" variant="secondary" onClick={() => setScan(true)} />}
      <TextInput label="收款账号" value={to} onChange={v => { setTo(v); setConfirm(false) }} isDisabled={loading} width="100%" />
      <TextInput label="积分数量" value={amount} onChange={v => { setAmount(v); setConfirm(false) }} isDisabled={loading} width="100%" />
      <TextInput label="公开备注" value={note} onChange={v => { setNote(v); setConfirm(false) }} isDisabled={loading} width="100%" />
      <Button label="送积分" variant="primary" isDisabled={loading || !wallet || !to.trim() || !validAmount || note.length > 512} onClick={() => void review()} />
      {confirm && <ConfirmDialog title="确认送积分" busy={loading} error={error} confirm="确认送出" back="返回修改" variant="primary" onConfirm={submit} onClose={() => setConfirm(false)}>送给 @{to.replace(/^@/, '')} {amount} {wallet?.name}？{note && <span> 备注：{note}</span>}</ConfirmDialog>}
    </>)}
    {mode === 'history' && <section className="grain-transfer-list">
      {!loading && !error && !entries.length && <p>还没有积分记录。</p>}
      {entries.map(entry => <details className="grain-transfer-row" key={entry.id}><summary><span className="grain-transfer-copy"><strong>{({ transfer: '转账', initial_allocation: '初始分配', mint: '发放积分', legacy_opening: '迁移期初余额', hold_reserve: '冻结', hold_release: '解冻', hold_settle: '结算' } as Record<string, string>)[entry.kind] ?? '积分变动'}</strong>{entry.public_note && <span>{entry.public_note}</span>}<time>{formatTimestamp(entry.inserted_at)}</time></span><b>{BigInt(entry.available_delta) > 0n ? '+' : ''}{entry.available_delta}</b></summary><div className="grain-transfer-details"><p>记录编号：{entry.id}</p><p>冻结变动：{entry.held_delta}</p>{entry.private_note && <p>私有备注：{entry.private_note}</p>}{entry.recipients.map(r => <p key={r.account_id}>收款账户 {r.account_id} · {r.amount} {r.note}</p>)}</div></details>)}
      {cursor && <Button label="加载更多" isDisabled={loading} variant="secondary" onClick={() => { setLoading(true); setError(''); void getPointHistory({ data: { token, pointId, before: cursor } }).then(page => { setEntries(prev => [...prev, ...page.data]); setCursor(page.meta.next_cursor) }).catch(e => setError(errorMessage(e, '加载失败'))).finally(() => setLoading(false)) }} />}
    </section>}
  </div>
}
