import { ImageGroup } from '~/components/ContentImages'
import { HistoryChanges } from '~/components/HistoryChanges'
import { ContactField } from '~/components/ContactField'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { LoadingState } from '~/components/LoadingState'
import { useTimeBoundary } from '~/components/useTimeBoundary'
import { attachmentImages } from '~/lib/attachments'
import { Button } from '@astryxdesign/core/Button'
import { TextArea } from '~/components/AutoTextArea'
import { Link, useNavigate } from '@tanstack/react-router'
import { UserIdentity } from '~/components/UserIdentity'
import { CheckCircle2, CircleAlert, Sprout } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { formatTimestamp } from '~/lib/format'
import { businessCopy } from '~/lib/business-copy'

import { useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import { applyForTask, appointTaskApplication, approveTaskResult, cancelTask, closeTask, completeTask, deleteTask, getTask, rejectTaskApplication, releaseTaskAssignee, requestTaskChanges, submitTaskResult } from './api'
import { pastTaskApplicationDeadline, pastTaskExecutionDeadline, taskEventLabel, taskApplicationStatusLabel, taskDisplayStatus, taskStatusLabel, type RiceTask, type TaskApplication, type TaskSubmission } from './types'
import { errorMessage } from '~/lib/util'

type TaskDetailInitial = { task: RiceTask | null; error: string; viewerToken: string | null }

const EMPTY_TEXT = { releaseReason: '', reason: '', contact: '', appointmentReason: '', result: '', reviewReason: '' }

const APPLICATION_NOTES: Partial<Record<TaskApplication['status'], string>> = {
  pending: '申请已提交，等发起人确认',
  not_selected: '本次申请未入选。',
  released: '发起人撤销了对你的指派，本次不再参与交付。',
  cancelled: '你申请过该任务；任务现已取消。',
  expired: '你申请过该任务；任务现已失效。',
}

export function TaskDetailPage({ taskId, initial }: { taskId: string; initial?: TaskDetailInitial }) {
  const { session, isReady } = useStoredSession()
  if (!isReady) return <LoadingState label="正在加载任务…" className="page loading-line" />
  const prepared = initial?.viewerToken === (session?.token ?? null) ? initial : undefined
  return <TaskDetails key={`${taskId}:${session?.user.id ?? 'guest'}`} taskId={taskId} initial={prepared} />
}

function TaskDetails({ taskId, initial }: { taskId: string; initial?: TaskDetailInitial }) {
  const { session, isReady } = useStoredSession()
  const [task, setTask] = useState<RiceTask | null>(initial?.task ?? null)
  const now = useTimeBoundary(task && ['open', 'in_progress', 'overdue', 'under_review'].includes(task.status) ? [task.application_deadline, task.execution_deadline] : [])
  const [error, setError] = useState(initial?.error ?? '')
  const [loading, setLoading] = useState(!initial)
  const skipInitialFetch = useRef(Boolean(initial))
  const [busy, setBusy] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const navigate = useNavigate()
  // 路由先显示缓存的旧数据、再在后台重新加载(比如编辑保存后跳回来):新数据到了就换上
  useEffect(() => { if (initial?.task) setTask(initial.task) }, [initial?.task])
  const [releaseId, setReleaseId] = useState<string | null>(null)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [text, setText] = useState(EMPTY_TEXT)
  const { releaseReason, reason, contact, appointmentReason, result, reviewReason } = text
  const setField = (key: keyof typeof EMPTY_TEXT) => (value: string) => setText((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!isReady) return
    if (skipInitialFetch.current) { skipInitialFetch.current = false; return }
    let active = true
    setLoading(true)
    setError('')
    void getTask({ data: { id: taskId, token: session?.token } })
      .then((next) => { if (active) setTask(next) })
      .catch((reason) => { if (active) setError(errorMessage(reason, '任务暂时无法加载')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isReady, session?.token, taskId])

  const pendingSubmissions = useMemo(() => task?.submissions?.filter((submission) => submission.status === 'pending') ?? [], [task])
  const latestRejected = useMemo(
    () => [...(task?.submissions ?? [])].reverse().find((item) => item.status === 'changes_requested' && (item.user?.id ?? task?.assignee?.id) === session?.user.id),
    [task, session?.user.id],
  )

  const run = async (action: () => Promise<RiceTask>) => {
    setBusy(true)
    setError('')
    try {
      const next = await action()
      setTask(next)
      window.dispatchEvent(new Event('rice-changed'))
      setApproveId(null)
      setRejectId(null)
      setApplyOpen(false)
      setCancelOpen(false)
      setCloseOpen(false)
      setCompleteOpen(false)
      setReleaseId(null)
      setText(EMPTY_TEXT)
    } catch (reason) {
      setError(errorMessage(reason, '操作失败'))
    } finally {
      setBusy(false)
    }
  }
  const act = (action: () => Promise<RiceTask>) => () => run(action)

  if (!isReady || (loading && !task)) return <LoadingState label="正在加载任务…" className="page loading-line" />
  if (!task) return <div className="page"><div className="inline-error">{error || '任务不存在'}</div></div>

  const expiredOpen = pastTaskApplicationDeadline(task, now)
  const overdueProgress = pastTaskExecutionDeadline(task, now)
  const actions = new Set(task.allowed_actions)
  const token = session?.token
  const capacity = task.capacity ?? 1
  const multiple = capacity > 1
  const refundTo = task.funding_node_id ? '节点账户' : '发布者'
  const assignees = task.assignees ?? (task.assignee ? [task.assignee] : [])
  const totalReward = task.total_reward_amount ?? task.reward_amount * capacity
  const recruiting = !task.application_closed && (!task.application_deadline || Date.parse(task.application_deadline) > now) && (task.appointed_count ?? assignees.length) < capacity
  // 多人任务里承接者看自己这一份的进度，而不是全体汇总出来的任务状态
  const personal = multiple && task.my_application_status === 'appointed' && task.my_status && task.my_status !== task.status ? task.my_status : null
  const personalOverdue = personal === 'overdue' || (personal === 'in_progress' && !!task.execution_deadline && Date.parse(task.execution_deadline) <= now)
  const workers = (task.applications ?? []).filter((item) => item.state === 'appointed' || item.state === 'overdue')
  const visibleEvents = (task.events ?? []).filter((event) => event.to_status !== 'draft')
  const pastRecords = [
    ...(task.past_applications ?? []).map(value => ({ type: 'application' as const, value })),
    ...(task.past_submissions ?? []).map(value => ({ type: 'submission' as const, value })),
  ].sort((a, b) => a.value.inserted_at.localeCompare(b.value.inserted_at) || a.value.id.localeCompare(b.value.id))

  return (
    <div className="page task-detail-page">
      <article className="content-card business-panel">
        <header className="task-detail-heading">
          <div>
            {personal ? (
              <span className={`task-status status-${personalOverdue ? 'overdue' : personal}`}>我的进度：{personalOverdue ? taskStatusLabel.overdue : taskStatusLabel[personal]}</span>
            ) : (
              <span className={`task-status status-${expiredOpen ? 'expired' : overdueProgress ? 'overdue' : task.status}`}>{taskDisplayStatus(task, now)}</span>
            )}
            <h1>{task.title}</h1>
            <p>{task.node?.name} · {task.creator.nickname || task.creator.handle}发起</p>
            {task.organizer_contact && <p>组织方联系方式：{task.organizer_contact}</p>}
          </div>

        </header>
        <section className="task-description">
          <h2>任务说明</h2>
          <p>{task.description}</p>
          <ImageGroup images={attachmentImages(task.attachments)} />
        </section>
        {task.requirement && <section className="task-description"><h2>交付要求</h2><p>{task.requirement}</p></section>}
        <section className="task-facts">
          <div><strong>{task.application_count}</strong><span>申请人数</span></div>
          <div><strong>{multiple ? `${task.appointed_count ?? assignees.length} / ${capacity}` : task.assignee?.nickname || task.assignee?.handle || '还没选定伙伴'}</strong><span>{multiple ? '已接收 / 人数上限' : '承接者'}</span></div>
          <div><strong className="rice-amount" aria-label={`${task.reward_amount} 稻米`}><Sprout size={24} />{task.reward_amount}</strong><span>{multiple ? '每人稻米激励' : '稻米激励'}</span></div>
        </section>

        {multiple && <p className="task-neutral-note">总稻米激励：{totalReward} 稻米{assignees.length > 0 && ` · 承接者：${assignees.map(user => user.nickname || user.handle).join('、')}`}</p>}

        {task.applications?.filter(application => application.status === 'appointed' && application.contact).map(application => <p className="task-neutral-note" key={application.id}>{multiple ? `${application.user.nickname || application.user.handle}：` : '承接者联系方式：'}{application.contact}</p>)}
        {task.my_application?.contact && <p className="task-neutral-note">我的联系方式：{task.my_application.contact}</p>}

        {task.reward_status === 'settled' ? (
          <div className="task-success-note"><CheckCircle2 size={18} /> 稻米激励已发放</div>
        ) : personal === 'completed' ? (
          <div className="task-success-note"><CheckCircle2 size={18} /> 你的交付已验收通过，{task.reward_amount > 0 ? `${task.reward_amount} 稻米已发放到你的账户` : '感谢参与'}</div>
        ) : null}
        {task.reward_status === 'refunded' ? <div className="task-neutral-note">稻米激励已退还至{task.funding_node_id ? '节点' : '发布者'}账户。</div> : null}

        {task.application_deadline ? <div className="task-neutral-note">申请截止：{formatTimestamp(task.application_deadline)}</div> : null}
        {task.execution_deadline && <div className="task-neutral-note">最晚交成果：{formatTimestamp(task.execution_deadline)}</div>}
        {(personal ? personalOverdue : task.status === 'overdue' || overdueProgress) && <div className="task-warning-note"><CircleAlert size={18} /><div><strong>已过交成果的时间</strong><p>请联系发起人，商量后续安排。</p><Link to="/profile/$actor" params={{ actor: task.creator.did }}>查看发起人主页</Link></div></div>}

        {task.status === 'completed' && !personal ? <div className="task-success-note"><CheckCircle2 size={18} /> 验收通过</div> : null}
        {personal === 'under_review' ? <div className="task-neutral-note">你的成果已提交，等发起人验收。</div> : null}
        {task.status === 'draft' ? <div className="task-neutral-note">草稿仅你可见，发布后才进入任务列表。</div> : null}
        {(task.status === 'expired' || expiredOpen) ? <div className="task-neutral-note">该任务已失效。</div> : null}
        {latestRejected && actions.has('submit_result') ? <ChangesRequested submission={latestRejected} /> : null}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        {!session && ['open', 'in_progress', 'overdue', 'under_review'].includes(task.status) && recruiting && <section className="task-action-section"><LoginLink className="primary-link" returnTo={`/tasks/${encodeURIComponent(taskId)}`}>登录后申请承接</LoginLink></section>}

        {actions.has('publish') && token ? <section className="task-action-section"><Link to="/tasks/new" className="primary-link">继续编辑</Link></section> : null}
        {actions.has('edit') && token && task.status !== 'draft' && task.status !== 'completed' && <section className="task-action-section"><Link to="/compose" search={{ kind: 'task', editId: task.id }} className="primary-link">编辑任务</Link></section>}

        {actions.has('apply') && token && recruiting ? (
          <section className="task-action-section">
            {!applyOpen ? (
              <Button label="申请承接" variant="primary" onClick={() => setApplyOpen(true)} />
            ) : (
              <>
                <TextArea label="申请理由" value={reason} onChange={setField('reason')} maxLength={512} width="100%" isOptional />
                <ContactField value={contact} onChange={setField('contact')} disabled={busy} />
                <div className="form-actions">
                  <Button label="取消" variant="secondary" onClick={() => setApplyOpen(false)} />
                  <Button label="提交申请" variant="primary" isDisabled={busy || !contact.trim() || contact.trim().length > 256}
                    clickAction={act(() => applyForTask({ data: { token, taskId, reason, contact: contact.trim() } }))} />
                </div>
              </>
            )}
          </section>
        ) : null}

        {task.my_application_status && APPLICATION_NOTES[task.my_application_status] ? (
          <div className="task-neutral-note">{APPLICATION_NOTES[task.my_application_status]}</div>
        ) : null}

        {(actions.has('appoint') || actions.has('reject_application')) && token && recruiting ? (
          <section className="task-action-section">
            <h2>待审批申请</h2>
            {actions.has('appoint') && <TextArea label="选人说明" value={appointmentReason} onChange={setField('appointmentReason')} maxLength={512} width="100%" isOptional />}
            <div className="applicant-list">
              {(task.applications ?? []).filter((item) => item.status === 'pending').map((application) => (
                <article key={application.id}>
                  <Link to="/profile/$actor" params={{ actor: application.user.did }} className="user-identity-link"><UserIdentity user={application.user} /></Link>
                  <p>{application.reason || '没有填写申请理由'}</p>
                  {application.contact && <p>联系方式：{application.contact}</p>}
                  <div className="form-actions">
                    {actions.has('reject_application') && <Button label="拒绝申请" variant="secondary" isDisabled={busy}
                      clickAction={act(() => rejectTaskApplication({ data: { token, taskId, applicationId: application.id } }))} />}
                    {actions.has('appoint') && <Button label="选这位伙伴" variant="primary" isDisabled={busy}
                      clickAction={act(() => appointTaskApplication({ data: { token, taskId, applicationId: application.id, appointmentReason } }))} />}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {actions.has('release_assignee') && token && workers.length > 0 ? (
          <section className="task-action-section">
            <h2>承接中</h2>
            <div className="applicant-list">
              {workers.map((application) => (
                <article key={application.id}>
                  <Link to="/profile/$actor" params={{ actor: application.user.did }} className="user-identity-link"><UserIdentity user={application.user} /></Link>
                  {application.contact && <p>联系方式：{application.contact}</p>}
                  {releaseId === application.id ? (
                    <>
                      <TextArea label="撤销说明" value={releaseReason} onChange={setField('releaseReason')} maxLength={512} width="100%" isOptional />
                      <div className="form-actions">
                        <Button label="保留" variant="secondary" isDisabled={busy} onClick={() => { setReleaseId(null); setField('releaseReason')('') }} />
                        <Button label="确认撤销指派" variant="destructive" isDisabled={busy}
                          clickAction={act(() => releaseTaskAssignee({ data: { token, taskId, applicationId: application.id, reason: releaseReason } }))} />
                      </div>
                    </>
                  ) : (
                    <div className="form-actions">
                      <Button label="撤销指派" variant="secondary" isDisabled={busy} onClick={() => { setReleaseId(application.id); setField('releaseReason')('') }} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {actions.has('complete') && token ? (
          <section className="task-action-section">
            <Button label="完成任务" variant="primary" onClick={() => setCompleteOpen(true)} />
            {completeOpen && <ConfirmDialog title="确认完成任务" busy={busy} error={error} onClose={() => setCompleteOpen(false)} back="返回" confirm="确认完成" variant="primary"
              onConfirm={act(() => completeTask({ data: { token, taskId } }))}>
              还在承接的伙伴（包括待验收的）都记为完成{task.reward_amount > 0 ? `，每人发放 ${task.reward_amount} 稻米` : ''}；等待中的申请落选{task.reward_amount > 0 ? `，空着名额的稻米退回${refundTo}` : ''}。适合活已经在线下做完、没在这里交成果的情况。
            </ConfirmDialog>}
          </section>
        ) : null}

        {actions.has('close') && token ? (
          <section className="task-action-section">
            <Button label="提前结束任务" variant="destructive" onClick={() => setCloseOpen(true)} />
            {closeOpen && <ConfirmDialog title="确认提前结束" busy={busy} error={error} onClose={() => setCloseOpen(false)} back="继续任务" confirm="确认结束" variant="destructive"
              onConfirm={act(() => closeTask({ data: { token, taskId } }))}>
              {multiple ? `已验收通过的交付保留；还在承接的伙伴会被撤销指派，等待中的申请落选，没发出去的稻米退回${refundTo}。` : `承接的伙伴会被撤销指派，冻结的稻米退回${refundTo}。`}结束后不能再申请或指派。
            </ConfirmDialog>}
          </section>
        ) : null}

        {actions.has('cancel') && token && !expiredOpen ? (
          <section className="task-action-section">
            <Button label="取消任务" variant="destructive" onClick={() => setCancelOpen(true)} />
            {cancelOpen && <ConfirmDialog title="确认取消任务" busy={busy} error={error} onClose={() => setCancelOpen(false)} back="保留任务" confirm="确认取消" variant="destructive"
              onConfirm={act(() => cancelTask({ data: { token, taskId } }))}>取消后任务保留记录，不能再申请；已冻结的 {totalReward} 稻米将退还。</ConfirmDialog>}
          </section>
        ) : null}

        {actions.has('delete') && token ? (
          <section className="task-action-section">
            <Button label="删除任务" variant="destructive" onClick={() => setDeleteOpen(true)} />
            {deleteOpen && <ConfirmDialog title="确认删除任务" busy={busy} error={error} onClose={() => setDeleteOpen(false)} back="保留任务" confirm="确认删除" variant="destructive"
              onConfirm={() => run(async () => { const deleted = await deleteTask({ data: { token, taskId } }); void navigate({ to: '/tasks' }); return deleted })}>
              删除后任务不再出现在列表和详情里，已发放和退回的稻米记录保留。
            </ConfirmDialog>}
          </section>
        ) : null}

        {actions.has('submit_result') && token ? (
          <section className="task-action-section">
            <h2>{latestRejected ? '修改并重新提交' : '交成果'}</h2>
            <TextArea label="说说完成情况" value={result} onChange={setField('result')} maxLength={4000} width="100%" isRequired />
            <div className="form-actions">
              <Button label="提交成果" variant="primary" isDisabled={!result.trim() || busy} clickAction={act(() => submitTaskResult({ data: { token, taskId, body: result } }))} />
            </div>
          </section>
        ) : null}

        {(actions.has('approve_result') || actions.has('request_changes')) && token && pendingSubmissions.map(pendingSubmission => (
          <section className="task-action-section review-section" key={pendingSubmission.id}>
            <h2>{multiple ? `${pendingSubmission.user.nickname || pendingSubmission.user.handle}的提交` : '承接者提交'}</h2>
            <p className="submission-copy">{pendingSubmission.body}</p>
            {rejectId === pendingSubmission.id && <TextArea label="退回理由" isRequired value={reviewReason} onChange={setField('reviewReason')} maxLength={512} width="100%" />}
            <div className="form-actions">
              {rejectId === pendingSubmission.id ? <>
                <Button label="取消" variant="secondary" onClick={() => { setRejectId(null); setField('reviewReason')('') }} />
                <Button label="确认退回修改" variant="destructive" isDisabled={!reviewReason.trim() || busy}
                  clickAction={act(() => requestTaskChanges({ data: { token, taskId, submissionId: pendingSubmission.id, reason: reviewReason } }))} />
              </> : <>
                <Button label="退回修改" variant="secondary" isDisabled={busy} onClick={() => { setRejectId(pendingSubmission.id); setField('reviewReason')(''); setApproveId(null) }} />
                <Button label="通过并发放稻米" variant="primary" isDisabled={busy} onClick={() => { setApproveId(pendingSubmission.id); setRejectId(null) }} />
              </>}
            </div>
            {approveId === pendingSubmission.id && <ConfirmDialog title="通过并发放稻米" busy={busy} error={error} onClose={() => setApproveId(null)} back="返回" confirm="通过并发放稻米" variant="primary"
              onConfirm={act(() => approveTaskResult({ data: { token, taskId, submissionId: pendingSubmission.id } }))}>
              向 {pendingSubmission.user?.nickname || pendingSubmission.user?.handle || task.assignee?.nickname || task.assignee?.handle} 发放 {task.reward_amount} 稻米，{multiple ? '其本次交付将完成' : '任务将完成'}。
            </ConfirmDialog>}
          </section>
        ))}

        {task.submissions?.length ? (
          <section className="task-history">
            <h2>提交历史</h2>
            {[...task.submissions].reverse().map((submission) => (
              <article key={submission.id}>
                <header><strong>{multiple && `${submission.user.nickname || submission.user.handle} · `}{submissionStatus(submission)}</strong><time>{formatTimestamp(submission.inserted_at)}</time></header>
                <p>{submission.body}</p>
                {submission.review_reason ? <blockquote>{submission.review_reason}</blockquote> : null}
              </article>
            ))}
          </section>
        ) : null}

        {pastRecords.length > 0 && (
          <details className="task-event-history">
            <summary>往期参与记录</summary>
            <ol>
              {pastRecords.map(item => item.type === 'application' ? <li key={item.value.id}>
                <strong>第 {item.value.round} 期申请 · {taskApplicationStatusLabel[item.value.status]}</strong>
                <span>{item.value.user.nickname || item.value.user.handle} · <time>{formatTimestamp(item.value.inserted_at)}</time></span>
                {item.value.reason && <blockquote>{item.value.reason}</blockquote>}
                {item.value.contact && <p>联系方式：{item.value.contact}</p>}
              </li> : <li key={item.value.id}>
                <strong>第 {item.value.round} 期交付 · {submissionStatus(item.value)}</strong>
                <span>{item.value.user.nickname || item.value.user.handle} · <time>{formatTimestamp(item.value.inserted_at)}</time></span>
                <blockquote>{item.value.body}</blockquote>
                {item.value.review_reason && <blockquote>{item.value.review_reason}</blockquote>}
              </li>)}
            </ol>
          </details>
        )}

        {visibleEvents.length ? (
          <details className="task-event-history">
            <summary>查看进展</summary>
            <ol>
              {visibleEvents.map((event) => (
                <li key={event.id}>
                  <strong>{taskEventLabel(event)}</strong>
                  <span>{event.actor?.nickname || event.actor?.handle || '系统'}{' · '}<time>{formatTimestamp(event.inserted_at)}</time></span>
                  {event.detail ? <blockquote>{businessCopy(event.detail)}</blockquote> : null}
                  {event.action === 'edited' && <HistoryChanges before={event.before} after={event.after} fields={[
                    ['node_id', '所属节点'], ['title', '任务标题'], ['organizer_contact', '组织方联系方式'],
                    ['description', '任务说明'], ['requirement', '交付要求'], ['application_deadline', '申请截止'],
                    ['execution_deadline', '最晚交成果'], ['reward_amount', '每人稻米激励'], ['capacity', '人数上限'], ['attachment_ids', '图片'],
                  ]} />}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </article>
    </div>
  )
}

function ChangesRequested({ submission }: { submission: TaskSubmission }) {
  return <div className="task-warning-note"><CircleAlert size={18} /><div><strong>再完善一下吧</strong><p>{submission.review_reason}</p></div></div>
}

function submissionStatus(submission: TaskSubmission) {
  if (submission.status === 'approved') return '验收通过'
  if (submission.status === 'changes_requested') return '再完善一下吧'
  return '等待验收'
}
