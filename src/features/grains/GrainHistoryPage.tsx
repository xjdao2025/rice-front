import { LoginLink } from '../session/LoginLink'
import { TextInput } from '@astryxdesign/core/TextInput'
import { integerInputError } from '~/lib/integer-input'
import { Button } from '@astryxdesign/core/Button'
import { LoadingState } from '~/components/LoadingState'
import { DetailDialog } from '~/components/DetailDialog'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { formatTimestamp } from '~/lib/format'
import { useStoredSession } from '../session/session'
import { fundCommunity, getWallet, walletEntryIncoming, type RiceWallet, type WalletEntry } from './api'

const labels: Record<WalletEntry['kind'], string> = { reserved: '冻结稻米', refunded: '退还稻米', grant: '发放稻米', gift: '送稻米', reward: '内容赞赏', task_reward: '任务激励', event_fee: '活动报名', community_fund: '向节点转入稻米' }
export function GrainHistoryPage({ nodeId }: { nodeId?: string }) {
  const { session } = useStoredSession()
  return <WalletHistory key={`${session?.token ?? 'guest'}:${nodeId ?? 'personal'}`} nodeId={nodeId} />
}

function WalletHistory({ nodeId }: { nodeId?: string }) {
  const { session, isReady } = useStoredSession()
  const [wallet, setWallet] = useState<RiceWallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => {
    if (!isReady) return
    if (!session) { setLoading(false); return }
    let active = true; ++request.current; setError('')
    setLoading(true)
    void getWallet({ data: { token: session.token, nodeId } }).then((value) => { if (active) setWallet(value) }).catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; ++request.current }
  }, [session?.token, isReady, nodeId])
  const more = async () => { if (!session || !wallet?.next_cursor || loading) return; const current = request.current; setLoading(true); setError(''); try { const page = await getWallet({ data: { token: session.token, nodeId, before: wallet.next_cursor } }); if (current === request.current) setWallet((previous) => ({ ...page, entries: [...(previous?.entries ?? []), ...page.entries] })) } catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : '加载失败') } finally { if (current === request.current) setLoading(false) } }
  if (isReady && !session) return <div className="page"><LoginLink className="primary-link">登录后查看稻米记录</LoginLink></div>
  return <div className="page grain-history-page"><h1>{nodeId ? '节点稻米' : '我的稻米'}</h1><p className="muted">测试稻米</p>
    <section className="grain-card"><header>稻米总量</header><div className="grain-balance-row"><strong>{wallet ? wallet.balance + wallet.frozen : '—'}</strong></div><div className="grain-metrics"><div><b>{wallet?.balance ?? '—'}</b><span>可用</span></div><div><b>{wallet?.frozen ?? '—'}</b><span>冻结稻米</span></div><div><b>{wallet?.earned ?? '—'}</b><span>累计获得</span></div></div></section>
    {nodeId && session && wallet && <CommunityFunding nodeId={nodeId} token={session.token} onFunded={(value) => { ++request.current; setWallet(value); setLoading(false); setError('') }} />}
    <h2>稻米记录</h2>{error && <p className="inline-error" role="alert">{error}</p>}{loading && (wallet ? <p className="refresh-status" role="status">正在加载记录…</p> : <LoadingState label="正在加载记录…" />)}
    <section className="grain-transfer-list">{wallet?.entries.map((entry) => <WalletEntryRow key={entry.id} entry={entry} userId={session?.user.id ?? ''} nodeId={nodeId} />)}</section>
    {!loading && !error && !wallet?.entries.length && <p className="search-hint">还没有稻米记录。</p>}{wallet?.next_cursor && <Button label="加载更多" variant="secondary" isDisabled={loading} clickAction={more} />}
  </div>
}

function WalletEntryRow({ entry, userId, nodeId }: { entry: WalletEntry; userId: string; nodeId?: string }) {
  const incoming = walletEntryIncoming(entry, userId, nodeId)
  const party = incoming ? entry.from_user : entry.to_user
  const node = incoming ? entry.from_node : entry.to_node
  const canSendAgain = !nodeId && (entry.kind === 'gift' || entry.kind === 'reward') && party?.id && party.id !== userId
  return <details className="grain-transfer-row">
    <summary>
      <span className="grain-transfer-copy">
        <strong>{labels[entry.kind]}</strong>
        {(party || node) && <span>{node?.name || party?.nickname || party?.handle}</span>}
        {entry.memo?.trim() && <span className="grain-transfer-memo">附言：{entry.memo}</span>}
        <time>{formatTimestamp(entry.inserted_at)}</time>
      </span>
      <b className={incoming ? 'incoming' : 'outgoing'}>{incoming ? '+' : '−'}{entry.amount}</b>
      <ChevronDown className="grain-transfer-chevron" size={18} aria-hidden="true" />
    </summary>
    <div className="grain-transfer-details">
      <p>记录编号：{entry.id}</p>
      {canSendAgain && <Link to="/me/grains/send" search={{ to: party.id }}>{incoming ? '回送稻米' : '再次送稻米'}</Link>}
    </div>
  </details>
}

function CommunityFunding({ nodeId, token, onFunded }: { nodeId: string; token: string; onFunded: (wallet: RiceWallet) => void }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<{ amount: string; id: string } | null>(null)
  const amountError = amount ? integerInputError(amount, '转入稻米数量', 1) : null
  const submit = async () => {
    if (busy || !amount || integerInputError(amount, '转入稻米数量', 1)) return
    if (request.current?.amount !== amount) request.current = { amount, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      onFunded(await fundCommunity({ data: { token, nodeId, amount: Number(amount), clientRequestId: request.current.id } }))
      request.current = null; setAmount(''); setOpen(false); setConfirm(false)
      window.dispatchEvent(new Event('rice-changed'))
    } catch (e) { setError(e instanceof Error ? e.message : '转入失败，请重试。') } finally { setBusy(false) }
  }
  return <section className="business-section">
    {!open ? <Button label="从个人账户转入稻米" variant="secondary" onClick={() => setOpen(true)} /> : <div className="form-stack">
      <TextInput label="转入多少稻米" value={amount} onChange={value => { setAmount(value); setConfirm(false); setError('') }} isDisabled={busy} status={amountError ? { type: 'error', message: amountError } : undefined} width="100%" isRequired />
      <p>节点与个人账户分开记账，转入后由节点管理员用于节点任务。</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="form-actions"><Button label="返回" variant="secondary" isDisabled={busy} onClick={() => { setOpen(false); setConfirm(false) }} /><Button label="向节点转入稻米" variant="primary" isDisabled={busy || !amount || !!amountError} onClick={() => setConfirm(true)} /></div>
      {confirm && <DetailDialog title="确认向节点转入稻米" className="post-dialog business-dialog compose-close-dialog" onClose={() => { if (!busy) setConfirm(false) }}><div className="business-panel form-stack">
        <p>将你的 {amount} 稻米转入此节点，由管理员用于节点任务。</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="form-actions"><Button label="返回修改" variant="secondary" isDisabled={busy} onClick={() => setConfirm(false)} /><Button label="确认转入" variant="primary" isDisabled={busy || !amount || !!amountError} clickAction={submit} /></div>
      </div></DetailDialog>}
    </div>}
  </section>
}
