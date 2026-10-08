import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import { TaskDetailPage } from './TaskDetailPage'
import type { RiceTask } from './types'

const state = vi.hoisted(() => ({ session: null as RiceSession | null }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: state.session, isReady: true }) }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

it('keeps a cancelled task readable to its publisher and applicants but hidden from strangers', () => {
  const task = {
    id: 'task-1', title: '修缮门楼', description: '保留任务记录', status: 'cancelled',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, application_count: 0, reward_amount: 1, reward_status: 'refunded',
    application_deadline: null, execution_deadline: null, applications: [], submissions: [], events: [],
    allowed_actions: [], my_application_status: null,
  } as unknown as RiceTask
  const initial = { task, error: '', viewerToken: 'token' }
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  expect(renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={initial} />)).toContain('修缮门楼')

  state.session = { token: 'token', user: { id: 'applicant' } } as RiceSession
  const applicantTask = { ...task, my_application_status: 'cancelled' as const }
  expect(renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ ...initial, task: applicantTask }} />)).toContain('修缮门楼')
  const fallbackTask = { ...task, my_application: {
    id: 'application-1', status: 'cancelled' as const, reason: '', inserted_at: '2026-09-21T09:00:00Z',
    user: { ...task.creator, id: 'applicant', did: 'did:example:applicant', handle: 'applicant' },
  } }
  expect(renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ ...initial, task: fallbackTask }} />)).toContain('修缮门楼')

  state.session = { token: 'token', user: { id: 'viewer' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={initial} />)
  expect(html).toContain('任务已取消。')
  expect(html).not.toContain('修缮门楼')

  state.session = null
  expect(renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task: applicantTask, error: '', viewerToken: null }} />)).not.toContain('修缮门楼')
})

it('shows an expired open task immediately and hides stale recruitment actions', () => {
  const task = {
    id: 'task-2', title: '修缮门楼', description: '说明', status: 'open',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, application_count: 1, reward_amount: 1, reward_status: 'reserved',
    application_deadline: '2026-09-21T09:00:00Z', applications: [], submissions: [], events: [],
    allowed_actions: ['appoint', 'reject_application', 'cancel'], my_application_status: null,
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('已失效')
  expect(html).not.toContain('待审批申请')
  expect(html).not.toContain('取消任务')
})

it('shows late delivery as overdue while leaving supplementary submission available', () => {
  const task = {
    id: 'task-3', title: '补交成果', description: '说明', status: 'in_progress',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: { id: 'assignee', did: 'did:example:assignee', handle: 'assignee' },
    application_count: 1, reward_amount: 1, reward_status: 'reserved',
    application_deadline: null, execution_deadline: '2026-09-21T09:00:00Z',
    applications: [], submissions: [], events: [], allowed_actions: ['submit_result'], my_application_status: 'appointed',
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'assignee' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('status-overdue')
  expect(html).toContain('任务已超时')
  expect(html).toContain('提交结果')
})

it('shows authorized old-round records in chronological order with contact', () => {
  const user = { id: 'applicant', did: 'did:example:applicant', handle: 'applicant' }
  const task = {
    id: 'task-4', title: '修缮门楼', description: '说明', status: 'open',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, application_count: 0, reward_amount: 1, reward_status: 'reserved',
    application_deadline: null, applications: [], submissions: [], events: [], allowed_actions: [],
    past_applications: [
      { id: 'application-2', round: 2, status: 'pending', reason: '第二期申请', contact: '第二期联系', user, inserted_at: '2026-09-03T09:00:00Z' },
      { id: 'application-1', round: 1, status: 'appointed', reason: '第一期申请', contact: '第一期联系', user, inserted_at: '2026-09-01T09:00:00Z' },
    ],
    past_submissions: [{ id: 'submission-1', round: 1, status: 'approved', body: '第一期交付', review_reason: null, user, inserted_at: '2026-09-02T09:00:00Z' }],
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html.indexOf('第一期申请')).toBeLessThan(html.indexOf('第一期交付'))
  expect(html.indexOf('第一期交付')).toBeLessThan(html.indexOf('第二期申请'))
  expect(html).toContain('联系方式：第一期联系')
})

it('does not offer editing for a completed task even if an older response advertises edit', () => {
  const task = {
    id: 'task-5', title: '已完成任务', description: '说明', status: 'completed',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, application_count: 0, reward_amount: 1, reward_status: 'settled',
    application_deadline: null, applications: [], submissions: [], events: [], allowed_actions: ['edit'],
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('已完成任务')
  expect(html).not.toContain('编辑任务')
})

it('keeps the return reason hidden until an administrator chooses to return a submission', () => {
  const task = {
    id: 'task-6', title: '待验收任务', description: '说明', status: 'in_progress',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: { id: 'assignee', did: 'did:example:assignee', handle: 'assignee' },
    application_count: 1, reward_amount: 1, reward_status: 'reserved',
    application_deadline: null, execution_deadline: null, applications: [], events: [],
    submissions: [{ id: 'submission-1', status: 'pending', body: '已交付', inserted_at: '2026-09-29T09:00:00Z' }],
    allowed_actions: ['approve_result', 'request_changes'],
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('退回修改')
  expect(html).toContain('验收并发放')
  expect(html).not.toContain('退回理由')
  expect(html).not.toContain('退回修改时必填')
})

it('reviews every participant separately and keeps recruitment available until capacity is filled', () => {
  const users = ['阿青', '小林'].map((nickname, i) => ({ id: `worker-${i}`, did: `did:example:worker-${i}`, handle: `worker-${i}`, nickname }))
  const task = {
    id: 'task-multiple', title: '多人清理步道', description: '说明', status: 'under_review', capacity: 3,
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, assignees: users, appointed_count: 2, application_count: 3,
    reward_amount: 10, total_reward_amount: 30, reward_status: 'reserved',
    application_deadline: '2099-09-21T09:00:00Z', execution_deadline: '2099-09-22T09:00:00Z',
    applications: [{ id: 'pending-worker', status: 'pending', user: { id: 'worker-3', nickname: '小周' } }],
    submissions: users.map((user, i) => ({ id: `submission-${i}`, user, status: 'pending', body: `成果-${i}`, inserted_at: '2026-09-29T09:00:00Z' })),
    events: [], allowed_actions: ['approve_result', 'request_changes', 'appoint'],
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const render = (value: RiceTask) => renderToStaticMarkup(<TaskDetailPage taskId={value.id} initial={{ task: value, error: '', viewerToken: 'token' }} />)
  const html = render(task)
  expect(html).toContain('阿青的提交')
  expect(html).toContain('小林的提交')
  expect(html.match(/验收并发放/g)).toHaveLength(2)
  expect(html).toContain('总奖励：30 稻米')
  expect(html).toContain('接收申请')
  expect(render({ ...task, appointed_count: 3 })).not.toContain('待审批申请')
  expect(render({ ...task, application_deadline: '2026-09-21T09:00:00Z' })).not.toContain('待审批申请')
})
