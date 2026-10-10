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

it('keeps a cancelled task readable to everyone, and offers deleting it to its manager', () => {
  const task = {
    id: 'task-1', title: '修缮门楼', description: '保留任务记录', status: 'cancelled',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, application_count: 0, reward_amount: 1, reward_status: 'refunded',
    application_deadline: null, execution_deadline: null, applications: [], submissions: [], events: [],
    allowed_actions: [], my_application_status: null,
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'viewer' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('修缮门楼')
  expect(html).not.toContain('删除任务')

  state.session = null
  expect(renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: null }} />)).toContain('修缮门楼')

  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const managed = { ...task, allowed_actions: ['delete'] } as RiceTask
  expect(renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task: managed, error: '', viewerToken: 'token' }} />)).toContain('删除任务')
})

it('offers completing a running task when the backend allows it', () => {
  const task = {
    id: 'task-2', title: '清理水渠', description: '线下做完', status: 'in_progress', capacity: 2,
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, application_count: 2, reward_amount: 20, reward_status: 'reserved',
    application_deadline: null, execution_deadline: null, applications: [], submissions: [], events: [],
    allowed_actions: ['complete', 'close'], my_application_status: null,
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('完成任务')
  expect(html).toContain('提前结束任务')
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
  expect(html).toContain('已过交成果的时间')
  expect(html).toContain('请联系发起人，商量后续安排。')
  expect(html).toContain('说说完成情况')
  expect(html).toContain('提交成果')
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
  expect(html).toContain('通过并发放稻米')
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
  expect(html.match(/通过并发放稻米/g)).toHaveLength(2)
  expect(html).toContain('总稻米激励：30 稻米')
  expect(html).toContain('选这位伙伴')
  expect(render({ ...task, appointed_count: 3 })).not.toContain('待审批申请')
  expect(render({ ...task, application_deadline: '2026-09-21T09:00:00Z' })).not.toContain('待审批申请')
})

it('uses the task copy for requested changes while preserving the administrator feedback', () => {
  const user = { id: 'worker', did: 'did:example:worker', handle: 'worker' }
  const task = {
    id: 'task-copy', title: '完善成果', description: '说明', status: 'in_progress',
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: user, application_count: 1, reward_amount: 1, reward_status: 'reserved',
    application_deadline: null, execution_deadline: null, applications: [], events: [],
    submissions: [{ id: 'submission-copy', status: 'changes_requested', body: '已提交说明',
      review_reason: '请补充现场照片，保留原来的任务奖励说明。', user, inserted_at: '2026-09-29T09:00:00Z' }],
    allowed_actions: ['submit_result'],
  } as unknown as RiceTask
  state.session = { token: 'token', user } as RiceSession
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: 'token' }} />)
  expect(html).toContain('再完善一下吧')
  expect(html).toContain('请补充现场照片，保留原来的任务奖励说明。')
  expect(html).toContain('说说完成情况')
  expect(html).toContain('提交成果')
  expect(html).not.toContain('结果未被认可')
})

it('shows a multi-assignee worker their own progress instead of the aggregate task status', () => {
  const me = { id: 'worker-0', did: 'did:example:worker-0', handle: 'worker-0', nickname: '阿青' }
  const task = {
    id: 'task-multiple', title: '多人清理步道', description: '说明', status: 'in_progress', capacity: 3,
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, assignees: [me], appointed_count: 2, application_count: 3,
    reward_amount: 10, total_reward_amount: 30, reward_status: 'reserved',
    application_deadline: '2099-09-21T09:00:00Z', execution_deadline: '2099-09-22T09:00:00Z',
    my_status: 'completed', my_application_status: 'appointed',
    applications: null, submissions: [{ id: 's', user: me, status: 'approved', body: '成果', inserted_at: '2026-09-29T09:00:00Z' }],
    events: [], allowed_actions: [],
  } as unknown as RiceTask
  state.session = { token: 'token', user: me } as RiceSession
  const render = (value: RiceTask) => renderToStaticMarkup(<TaskDetailPage taskId={value.id} initial={{ task: value, error: '', viewerToken: 'token' }} />)
  const html = render(task)
  expect(html).toContain('我的进度：已完成')
  expect(html).toContain('10 稻米已发放到你的账户')
  expect(html).not.toContain('>进行中<')
  expect(render({ ...task, my_status: 'overdue' })).toContain('已过交成果的时间')
  expect(render({ ...task, my_status: 'under_review' })).toContain('等发起人验收')
  expect(render({ ...task, my_status: 'in_progress', my_application_status: 'released' })).toContain('撤销了对你的指派')
})

it('lets an administrator release a worker or end a multi-assignee task early only when the backend allows it', () => {
  const users = ['阿青', '小林'].map((nickname, i) => ({ id: `worker-${i}`, did: `did:example:worker-${i}`, handle: `worker-${i}`, nickname }))
  const task = {
    id: 'task-multiple', title: '多人清理步道', description: '说明', status: 'in_progress', capacity: 3,
    creator: { id: 'publisher', did: 'did:example:publisher', handle: 'publisher' },
    assignee: null, assignees: users, appointed_count: 2, application_count: 2,
    reward_amount: 10, total_reward_amount: 30, reward_status: 'reserved',
    application_deadline: '2099-09-21T09:00:00Z', execution_deadline: '2099-09-22T09:00:00Z',
    applications: [
      { id: 'app-0', status: 'appointed', state: 'appointed', user: users[0], contact: '微信 a' },
      { id: 'app-1', status: 'appointed', state: 'under_review', user: users[1] },
    ],
    submissions: [], events: [], allowed_actions: ['release_assignee', 'close'],
  } as unknown as RiceTask
  state.session = { token: 'token', user: { id: 'publisher' } } as RiceSession
  const render = (value: RiceTask) => renderToStaticMarkup(<TaskDetailPage taskId={value.id} initial={{ task: value, error: '', viewerToken: 'token' }} />)
  const html = render(task)
  expect(html.match(/撤销指派/g)).toHaveLength(1)
  expect(html).toContain('微信 a')
  expect(html).toContain('提前结束任务')
  const locked = render({ ...task, allowed_actions: ['release_assignee'] })
  expect(locked).not.toContain('提前结束任务')
  expect(render({ ...task, allowed_actions: [] })).not.toContain('撤销指派')
})
