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
import { CheckCircle2, CircleAlert, Sprout } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { formatTimestamp } from '~/lib/format'
import { businessCopy } from '~/lib/business-copy'

import { useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import {
  applyForTask,
  appointTaskApplication,
  approveTaskResult,
  cancelTask,
  getTask,
  rejectTaskApplication,
  requestTaskChanges,
  submitTaskResult,
} from './api'
import {
  pastTaskApplicationDeadline,
  pastTaskExecutionDeadline,
  taskEventLabel,
  taskApplicationStatusLabel,
  taskDisplayStatus,
  type RiceTask,
  type TaskSubmission,
} from './types'

type TaskDetailInitial = { task: RiceTask | null; error: string; viewerToken: string | null }

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
  const [approveId, setApproveId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [appointmentReason, setAppointmentReason] = useState('')
  const [result, setResult] = useState('')
  const [reviewReason, setReviewReason] = useState('')

  useEffect(() => {
    if (!isReady) return
    if (skipInitialFetch.current) { skipInitialFetch.current = false; return }
    let active = true
    setLoading(true)
    setError('')
    void getTask({ data: { id: taskId, token: session?.token } })
      .then((next) => { if (active) setTask(next) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '任务暂时无法加载') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isReady, session?.token, taskId])

  const pendingSubmissions = useMemo(
    () => task?.submissions?.filter((submission) => submission.status === 'pending') ?? [],
    [task],
  )
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
      setReason('')
      setContact('')
      setAppointmentReason('')
      setResult('')
      setReviewReason('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  if (!isReady || (loading && !task)) return <LoadingState label="正在加载任务…" className="page loading-line" />
  if (!task) return <div className="page"><div className="inline-error">{error || '任务不存在'}</div></div>
  if (task.status === 'cancelled' && task.creator.id !== session?.user.id && !task.can_manage && !(session && (task.my_application_status || task.my_application))) return <div className="page"><p className="search-hint">任务已取消。</p></div>

  const expiredOpen = pastTaskApplicationDeadline(task, now)
  const overdueProgress = pastTaskExecutionDeadline(task, now)
  const actions = new Set(task.allowed_actions)
  const token = session?.token
  const capacity = task.capacity ?? 1
  const multiple = capacity > 1
  const assignees = task.assignees ?? (task.assignee ? [task.assignee] : [])
  const totalReward = task.total_reward_amount ?? task.reward_amount * capacity
  const recruiting = !task.application_closed && (!task.application_deadline || Date.parse(task.application_deadline) > now) && (task.appointed_count ?? assignees.length) < capacity
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
            <span className={`task-status status-${expiredOpen ? 'expired' : overdueProgress ? 'overdue' : task.status}`}>{taskDisplayStatus(task, now)}</span>
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
          <div><strong>{multiple ? `${task.appointed_count ?? assignees.length} / ${capacity}` : task.assignee?.nickname || task.assignee?.handle || '待任命'}</strong><span>{multiple ? '已接收 / 人数上限' : '承接者'}</span></div>
          <div><strong className="rice-amount" aria-label={`${task.reward_amount} 稻米`}><Sprout size={24} />{task.reward_amount}</strong><span>{multiple ? '每人奖励' : '任务奖励'}</span></div>
        </section>

        {multiple && <p className="task-neutral-note">总奖励：{totalReward} 稻米{assignees.length > 0 && ` · 承接者：${assignees.map(user => user.nickname || user.handle).join('、')}`}</p>}

        {task.applications?.filter(application => application.status === 'appointed' && application.contact).map(application => <p className="task-neutral-note" key={application.id}>{multiple ? `${application.user.nickname || application.user.handle}：` : '承接者联系方式：'}{application.contact}</p>)}
        {task.my_application?.contact && <p className="task-neutral-note">我的联系方式：{task.my_application.contact}</p>}

        {task.reward_status === 'settled' ? (
          <div className="task-success-note"><CheckCircle2 size={18} /> 任务奖励已发放给承接者</div>
        ) : null}
        {task.reward_status === 'refunded' ? (
          <div className="task-neutral-note">任务奖励对应的稻米已退还至{task.funding_node_id ? '节点' : '发布者'}账户。</div>
        ) : null}

        {task.application_deadline ? (
          <div className="task-neutral-note">申请截止：{formatTimestamp(task.application_deadline)}</div>
        ) : null}
        {task.execution_deadline && <div className="task-neutral-note">交付截止：{formatTimestamp(task.execution_deadline)}</div>}
        {(task.status === 'overdue' || overdueProgress) && <div className="task-warning-note"><CircleAlert size={18} /><div><strong>任务已超时</strong><p>请与负责人 {task.creator.nickname || task.creator.handle} 联系，确认交付安排。</p><Link to="/profile/$actor" params={{ actor: task.creator.did }}>查看负责人主页</Link></div></div>}

        {task.status === 'completed' ? (
          <div className="task-success-note"><CheckCircle2 size={18} /> 结果已认可，任务完成</div>
        ) : null}
        {task.status === 'draft' ? <div className="task-neutral-note">草稿仅你可见，发布后才进入任务列表。</div> : null}
        {(task.status === 'expired' || expiredOpen) ? <div className="task-neutral-note">该任务已失效。</div> : null}
        {latestRejected && actions.has('submit_result') ? <ChangesRequested submission={latestRejected} /> : null}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        {!session && ['open', 'in_progress', 'overdue', 'under_review'].includes(task.status) && recruiting && <section className="task-action-section"><LoginLink className="primary-link" returnTo={`/tasks/${encodeURIComponent(taskId)}`}>登录后申请承接</LoginLink></section>}

        {actions.has('publish') && token ? (
          <section className="task-action-section">
            <Link to="/tasks/new" className="primary-link">继续编辑</Link>
          </section>
        ) : null}
        {actions.has('edit') && token && task.status !== 'draft' && task.status !== 'completed' && <section className="task-action-section"><Link to="/compose" search={{ kind: 'task', editId: task.id }} className="primary-link">编辑任务</Link></section>}

        {actions.has('apply') && token && recruiting ? (
          <section className="task-action-section">
            {!applyOpen ? (
              <Button label="申请承接" variant="primary" onClick={() => setApplyOpen(true)} />
            ) : (
              <>
                <TextArea
                  label="申请理由"
                  value={reason}
                  onChange={setReason}
                  maxLength={512}
                  width="100%"
                  isOptional
                />
                <ContactField value={contact} onChange={setContact} disabled={busy} />
                <div className="form-actions">
                  <Button label="取消" variant="secondary" onClick={() => setApplyOpen(false)} />
                  <Button
                    label="提交申请"
                    variant="primary"
                    isDisabled={busy || !contact.trim() || contact.trim().length > 256}
                    clickAction={() => run(() => applyForTask({ data: { token, taskId, reason, contact: contact.trim() } }))}
                  />
                </div>
              </>
            )}
          </section>
        ) : null}

        {task.my_application_status === 'pending' ? (
          <div className="task-neutral-note">申请已提交，等待发布者审批。</div>
        ) : null}
        {task.my_application_status === 'not_selected' ? (
          <div className="task-neutral-note">本次申请未入选。</div>
        ) : null}
        {task.my_application_status === 'cancelled' ? (
          <div className="task-neutral-note">你申请过该任务；任务现已取消。</div>
        ) : null}
        {task.my_application_status === 'expired' ? (
          <div className="task-neutral-note">你申请过该任务；任务现已失效。</div>
        ) : null}

        {(actions.has('appoint') || actions.has('reject_application')) && token && recruiting ? (
          <section className="task-action-section">
            <h2>待审批申请</h2>
            {actions.has('appoint') && <TextArea
              label="选人说明"
              value={appointmentReason}
              onChange={setAppointmentReason}
              maxLength={512}
              width="100%"
              isOptional
            />}
            <div className="applicant-list">
              {(task.applications ?? []).filter((item) => item.status === 'pending').map((application) => (
                <article key={application.id}>
                  <strong>{application.user.nickname || application.user.handle}</strong>
                  <p>{application.reason || '没有填写申请理由'}</p>
                  {application.contact && <p>联系方式：{application.contact}</p>}
                  <div className="form-actions">
                    {actions.has('reject_application') && <Button
                      label="拒绝申请"
                      variant="secondary"
                      isDisabled={busy}
                      clickAction={() => run(() => rejectTaskApplication({
                        data: { token, taskId, applicationId: application.id },
                      }))}
                    />}
                    {actions.has('appoint') && <Button
                      label="接收申请"
                      variant="primary"
                      isDisabled={busy}
                      clickAction={() => run(() => appointTaskApplication({
                        data: {
                          token,
                          taskId,
                          applicationId: application.id,
                          appointmentReason,
                        },
                      }))}
                    />}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {actions.has('cancel') && token && !expiredOpen ? (
          <section className="task-action-section">
            <Button label="取消任务" variant="destructive" onClick={() => setCancelOpen(true)} />
            {cancelOpen && <DetailDialog title="确认取消任务" className="post-dialog business-dialog compose-close-dialog" onClose={() => { if (!busy) setCancelOpen(false) }}><div className="business-panel form-stack">
              <p>取消后任务保留记录，不能再申请；已冻结的 {totalReward} 稻米将退还。</p>
              {error && <p className="inline-error" role="alert">{error}</p>}
              <div className="form-actions"><Button label="保留任务" variant="secondary" isDisabled={busy} onClick={() => setCancelOpen(false)} /><Button label="确认取消" variant="destructive" isDisabled={busy} clickAction={() => run(() => cancelTask({ data: { token, taskId } }))} /></div>
            </div></DetailDialog>}
          </section>
        ) : null}

        {actions.has('submit_result') && token ? (
          <section className="task-action-section">
            <h2>{latestRejected ? '修改并重新提交' : '提交完成'}</h2>
            <TextArea
              label="完成说明"
              value={result}
              onChange={setResult}
              maxLength={4000}
              width="100%"
              isRequired
            />
            <div className="form-actions">
              <Button
                label="提交结果"
                variant="primary"
                isDisabled={!result.trim() || busy}
                clickAction={() => run(() => submitTaskResult({ data: { token, taskId, body: result } }))}
              />
            </div>
          </section>
        ) : null}

        {(actions.has('approve_result') || actions.has('request_changes')) && token && pendingSubmissions.map(pendingSubmission => (
          <section className="task-action-section review-section" key={pendingSubmission.id}>
            <h2>{multiple ? `${pendingSubmission.user.nickname || pendingSubmission.user.handle}的提交` : '承接者提交'}</h2>
            <p className="submission-copy">{pendingSubmission.body}</p>
            {rejectId === pendingSubmission.id && <TextArea
              label="退回理由"
              isRequired
              value={reviewReason}
              onChange={setReviewReason}
              maxLength={512}
              width="100%"
            />}
            <div className="form-actions">
              {rejectId === pendingSubmission.id ? <>
                <Button label="取消" variant="secondary" onClick={() => { setRejectId(null); setReviewReason('') }} />
                <Button
                  label="确认退回修改"
                  variant="destructive"
                  isDisabled={!reviewReason.trim() || busy}
                  clickAction={() => run(() => requestTaskChanges({
                    data: { token, taskId, submissionId: pendingSubmission.id, reason: reviewReason },
                  }))}
                />
              </> : <>
                <Button label="退回修改" variant="secondary" isDisabled={busy} onClick={() => { setRejectId(pendingSubmission.id); setReviewReason(''); setApproveId(null) }} />
                <Button label="验收并发放" variant="primary" isDisabled={busy} onClick={() => { setApproveId(pendingSubmission.id); setRejectId(null) }} />
              </>}
            </div>
            {approveId === pendingSubmission.id && <DetailDialog title="确认验收并发放" className="post-dialog business-dialog compose-close-dialog" onClose={() => { if (!busy) setApproveId(null) }}><div className="business-panel form-stack">
              <p>向 {pendingSubmission.user?.nickname || pendingSubmission.user?.handle || task.assignee?.nickname || task.assignee?.handle} 发放 {task.reward_amount} 稻米，{multiple ? '其本次交付将完成' : '任务将完成'}。</p>
              {error && <p className="inline-error" role="alert">{error}</p>}
              <div className="form-actions"><Button label="返回" variant="secondary" isDisabled={busy} onClick={() => setApproveId(null)} /><Button label="确认验收并发放" variant="primary" isDisabled={busy} clickAction={() => run(() => approveTaskResult({ data: { token, taskId, submissionId: pendingSubmission.id } }))} /></div>
            </div></DetailDialog>}
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
                  <span>
                    {event.actor?.nickname || event.actor?.handle || '系统'}
                    {' · '}
                    <time>{formatTimestamp(event.inserted_at)}</time>
                  </span>
                  {event.detail ? <blockquote>{businessCopy(event.detail)}</blockquote> : null}
                  {event.action === 'edited' && <HistoryChanges before={event.before} after={event.after} fields={[
                    ['node_id', '所属节点'], ['title', '任务标题'], ['organizer_contact', '组织方联系方式'],
                    ['description', '任务说明'], ['requirement', '交付要求'], ['application_deadline', '申请截止'],
                    ['execution_deadline', '交付截止'], ['reward_amount', '每人奖励'], ['capacity', '人数上限'], ['attachment_ids', '图片'],
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
  return (
    <div className="task-warning-note">
      <CircleAlert size={18} />
      <div><strong>结果未被认可，可修改后重新提交</strong><p>{submission.review_reason}</p></div>
    </div>
  )
}

function submissionStatus(submission: TaskSubmission) {
  if (submission.status === 'approved') return '结果已认可'
  if (submission.status === 'changes_requested') return '结果未被认可'
  return '等待验收'
}
