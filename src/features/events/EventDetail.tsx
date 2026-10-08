import { ImageGroup } from '~/components/ContentImages'
import { HistoryChanges } from '~/components/HistoryChanges'
import { ContactField } from '~/components/ContactField'
import { DetailDialog } from '~/components/DetailDialog'
import { LoadingState } from '~/components/LoadingState'
import { useTimeBoundary } from '~/components/useTimeBoundary'
import { attachmentImages } from '~/lib/attachments'
import { Button } from '@astryxdesign/core/Button'
import { TextArea } from '~/components/AutoTextArea'
import { Link } from '@tanstack/react-router'
import { Sprout } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatTimestamp } from '~/lib/format'
import { useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import { applicationStatusLabel, eventAcceptsApplications, eventAction, eventDisplayStatus, eventSettlementAmount, eventStatusLabel, getEvent, type EventActionInput, type RiceEvent } from './api'

const historyLabels: Record<string, string> = { applied: '提交申请', completed: '活动结束', application_completed: '完成参与记录', application_cancelled: '报名已取消', application_withdrawn: '撤销申请', created: '创建活动', published: '发布活动', edited: '编辑活动', application_created: '提交申请', application_approved: '通过申请', application_rejected: '拒绝申请', application_removed: '移除报名', started: '活动开始', finished: '活动结束', cancelled: '活动取消', application_not_selected: '申请未入选' }
type EventDetailInitial = { event: RiceEvent | null; error: string; viewerToken: string | null }

export function EventDetail({ eventId, initial }: { eventId: string; initial?: EventDetailInitial }) {
  const { session, isReady } = useStoredSession()
  if (!isReady) return <LoadingState label="正在加载活动…" className="page loading-line" />
  const prepared = initial?.viewerToken === (session?.token ?? null) ? initial : undefined
  return <EventDetails key={`${eventId}:${session?.user.id ?? 'guest'}`} eventId={eventId} initial={prepared} />
}

function EventDetails({ eventId, initial }: { eventId: string; initial?: EventDetailInitial }) {
  const { session, isReady } = useStoredSession()
  const [event, setEvent] = useState<RiceEvent | null>(initial?.event ?? null)
  const now = useTimeBoundary(event && ['open', 'in_progress'].includes(event.status) ? [event.application_deadline, event.starts_at, event.ends_at] : [])
  const [error, setError] = useState(initial?.error ?? '')
  const skipInitialFetch = useRef(Boolean(initial))
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [confirm, setConfirm] = useState<'apply' | 'withdraw' | 'finish' | 'cancel' | null>(null)
  const [applicationAction, setApplicationAction] = useState<{ id: string; action: 'reject' | 'remove' } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!isReady) return
    if (skipInitialFetch.current) { skipInitialFetch.current = false; return }
    let active = true
    setError('')
    void getEvent({ data: { id: eventId, token: session?.token } }).then((value) => { if (active) setEvent(value) }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [isReady, session?.token, eventId, now])
  const run = async (action: EventActionInput['action'], applicationId?: string) => {
    if (!session || busy) return
    if (action === 'apply' && !canApply) return
    if (action === 'apply' && (!contact.trim() || contact.trim().length > 256)) { setError('请填写联系方式，最多 256 字。'); return }
    setBusy(true); setError('')
    try { setEvent(await eventAction({ data: { token: session.token, id: eventId, action, applicationId, reason, contact: action === 'apply' ? contact.trim() : undefined } })); setConfirm(null); setApplicationAction(null); setReason(''); setContact(''); window.dispatchEvent(new Event('rice-changed')) }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  const acceptsApplications = Boolean(event && eventAcceptsApplications(event, now))
  const canApply = acceptsApplications && Boolean(event?.allowed_actions.includes('apply'))
  const canWithdraw = Boolean(event?.my_application?.allowed_actions.includes('withdraw') && Date.parse(event.starts_at) > now)
  const canEdit = event?.status !== 'completed' && event?.allowed_actions.includes('edit')
  const hasEventActions = canApply || canWithdraw || event?.allowed_actions.some(action => ['finish', 'cancel'].includes(action)) || canEdit
  const settlementAmount = event ? eventSettlementAmount(event) : null
  return <div className="page content-card business-panel event-detail-page">{error && <p className="inline-error" role="alert">{error}</p>}{!event && !error && <LoadingState label="正在加载活动…" />}{event && <>
    <span className={`task-status status-${event.status}`}>{eventDisplayStatus(event, now)}</span><h1>{event.title}</h1><p className="muted">{event.node.name} · {event.creator.nickname || event.creator.handle}发起</p>
    <div className={`business-money${event.fee_amount ? '' : ' event-fee-free'}`}><strong className="rice-amount">{event.fee_amount ? <><Sprout size={25} />每人 {event.fee_amount} 稻米</> : '免费'}</strong></div>
    <section className="business-section"><h2>活动时间</h2><p className="business-description">活动开始：<time dateTime={event.starts_at}>{formatTimestamp(event.starts_at)}</time><br />活动结束：<time dateTime={event.ends_at}>{formatTimestamp(event.ends_at)}</time></p></section>
    <p>{event.location}</p>
    <section className="business-section"><h2>报名截止</h2><p className="business-description"><time dateTime={event.application_deadline}>{formatTimestamp(event.application_deadline)}</time></p></section>
    {event.organizer_contact && <p>组织方联系方式：{event.organizer_contact}</p>}
    <div className="business-counts"><div><strong>{event.application_count}</strong><span>报名人数</span></div><div><strong>{event.approved_count} / {event.capacity}</strong><span>已通过 / 名额</span></div></div>
    {event.my_application && <p className="task-neutral-note">我的报名：{applicationStatusLabel[event.my_application.status]}{event.my_application.payment_status === 'refunded' ? '，稻米已退回' : event.my_application.payment_status === 'settled' ? (event.my_application.settlement_node_id ? '，稻米已转入节点' : '，稻米已结算') : ''}</p>}
    {event.my_application?.contact && <p className="task-neutral-note">我的联系方式：{event.my_application.contact}</p>}
    {!session && acceptsApplications && <div className="business-section"><LoginLink className="primary-link" returnTo={`/events/${encodeURIComponent(eventId)}`}>登录后报名参加</LoginLink></div>}
    {session && (confirm === 'apply' ? <section className="business-section"><h2>报名参加</h2>
      <p>{event.fee_amount ? `报名需 ${event.fee_amount} 稻米，未通过会全部退回。` : '本次活动免费。'}</p>
      <div className="form-stack"><TextArea label="参与说明" value={reason} onChange={setReason} maxLength={512} width="100%" /><ContactField value={contact} onChange={setContact} disabled={busy} />
        <div className="form-actions"><Button label="返回" variant="secondary" isDisabled={busy} onClick={() => setConfirm(null)} /><Button label="确认报名" variant="primary" isDisabled={busy || !canApply || !contact.trim() || contact.trim().length > 256} clickAction={() => run('apply')} /></div>
      </div>
    </section> : hasEventActions && <div className="button-row business-section">{canApply && <Button label="报名参加" variant="primary" onClick={() => setConfirm('apply')} />}{canWithdraw && <Button label="撤销报名" variant="secondary" onClick={() => setConfirm('withdraw')} />}{event.allowed_actions.includes('finish') && <Button label="确认结束" variant="primary" onClick={() => setConfirm('finish')} />}{event.allowed_actions.includes('cancel') && <Button label="取消活动" variant="destructive" onClick={() => setConfirm('cancel')} />}{canEdit && <Link to="/compose" search={event.status === 'draft' ? { kind: 'activity' } : { kind: 'activity', editId: event.id }}>{event.status === 'draft' ? '继续编辑' : '编辑活动'}</Link>}</div>)}
    {confirm && confirm !== 'apply' && <DetailDialog title={confirm === 'withdraw' ? '确认撤销报名' : confirm === 'finish' ? '确认结束' : '确认取消活动'} className="post-dialog business-dialog compose-close-dialog" onClose={() => { if (!busy) setConfirm(null) }}><div className="business-panel form-stack">
      <p>{confirm === 'withdraw' ? '撤销后，这一期不能再报名。' : confirm === 'finish' ? event.fee_amount ? settlementAmount !== null && event.settlement_node_id === event.node.id ? `确认后，${settlementAmount} 稻米将转入 ${event.node.name}。` : '确认后，稻米将按已通过报名者的实际记录结算。' : `确认后，将完成 ${event.approved_count} 位有效参与者的活动记录。` : '取消后不能再报名，尚未结算的稻米会退回报名者。'}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="form-actions"><Button label="返回" variant="secondary" isDisabled={busy} onClick={() => setConfirm(null)} /><Button label={confirm === 'withdraw' ? '确认撤销' : confirm === 'finish' ? '确认结束' : '确认取消'} variant={confirm === 'finish' ? 'primary' : 'destructive'} isDisabled={busy || (confirm === 'withdraw' && !canWithdraw)} clickAction={() => run(confirm, confirm === 'withdraw' ? event.my_application?.id : undefined)} /></div>
    </div></DetailDialog>}
    <section className="business-section"><h2>活动介绍</h2><p className="business-description">{event.description}</p><ImageGroup images={attachmentImages(event.attachments)} /></section>
    {(event.can_manage ?? event.creator.id === session?.user.id) && <section className="business-section"><h2>报名申请</h2>{event.applications.length ? event.applications.map((a) => {
      const actions = (['approve', 'reject', 'remove'] as const).filter(action => a.allowed_actions.includes(action) && (action === 'remove' || Date.parse(event.starts_at) > now))
      return <article className="candidate form-stack" key={a.id}>
      <div><strong>{a.user.nickname || a.user.handle}</strong><span className="task-status">{applicationStatusLabel[a.status]}</span><p>{a.reason}</p>{a.contact && <p>联系方式：{a.contact}</p>}</div>
      {actions.length > 0 && <div className="form-actions">{actions.map(action => <Button key={action} label={action === 'approve' ? '通过' : action === 'reject' ? '拒绝' : event.fee_amount ? '移除并退回稻米' : '移除报名'} variant={action === 'approve' ? 'primary' : 'secondary'} isDisabled={busy} onClick={() => { if (action === 'approve') void run(action, a.id); else setApplicationAction({ id: a.id, action }) }} />)}</div>}
      {applicationAction?.id === a.id && <DetailDialog title={applicationAction.action === 'reject' ? '确认拒绝申请' : '确认移除报名'} className="post-dialog business-dialog compose-close-dialog" onClose={() => { if (!busy) setApplicationAction(null) }}><div className="business-panel form-stack">
        <p>确认{applicationAction.action === 'reject' ? '拒绝' : '移除'} {a.user.nickname || a.user.handle} 的{applicationAction.action === 'reject' ? '申请' : '报名'}？{event.fee_amount ? `报名所需的 ${event.fee_amount} 稻米会全部退回。` : applicationAction.action === 'remove' ? '移除后将释放参与名额。' : ''}</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="form-actions"><Button label="返回" variant="secondary" isDisabled={busy} onClick={() => setApplicationAction(null)} /><Button label={applicationAction.action === 'reject' ? '确认拒绝' : event.fee_amount ? '移除并退回稻米' : '确认移除'} variant="destructive" isDisabled={busy} clickAction={() => run(applicationAction.action, a.id)} /></div>
      </div></DetailDialog>}
    </article>}) : <p>还没有申请。</p>}</section>}
    {!!event.past_applications?.length && <details className="business-section"><summary>往期报名</summary><ul className="business-history">{event.past_applications.map(a => <li key={a.id}><strong>第 {a.round} 期 · {a.user.nickname || a.user.handle}</strong><p>{applicationStatusLabel[a.status]} · {a.fee_amount ? `${a.fee_amount} 稻米 · ${a.payment_status === 'settled' ? (a.settlement_node_id ? '稻米已转入节点' : '稻米已结算') : a.payment_status === 'refunded' ? '稻米已退回' : a.payment_status === 'reserved' ? '稻米已冻结' : '未扣稻米'}` : '免费'}</p><time>{formatTimestamp(a.inserted_at)}</time>{a.reason && <p>{a.reason}</p>}{a.contact && <p>联系方式：{a.contact}</p>}</li>)}</ul></details>}
    {!!event.history.length && <details className="business-section"><summary>查看进展</summary><ol className="business-history">{event.history.map((h) => <li key={h.id}><time>{formatTimestamp(h.inserted_at)}</time><p>{h.actor?.nickname || h.actor?.handle || '系统'} · {historyLabels[h.action] || (h.to_status in eventStatusLabel ? eventStatusLabel[h.to_status as keyof typeof eventStatusLabel] : '更新了活动进展')}</p>{h.action === 'edited' && <HistoryChanges before={h.before} after={h.after} fields={[
      ['node_id', '所属节点'], ['title', '活动标题'], ['organizer_contact', '组织方联系方式'],
      ['description', '活动介绍'], ['location', '活动地点'], ['application_deadline', '报名截止'],
      ['starts_at', '活动开始'], ['ends_at', '活动结束'], ['capacity', '参与名额'],
      ['fee_amount', '每人所需稻米'], ['attachment_ids', '图片'],
    ]} />}</li>)}</ol></details>}
  </>}</div>
}
