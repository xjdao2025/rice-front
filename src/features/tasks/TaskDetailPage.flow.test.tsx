import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import { TaskDetailPage } from './TaskDetailPage'
import { myTaskGroup, type RiceTask } from './types'

// 真实后端响应:由 rice/test/rice_web/api/task_flow_test.exs 走完整个多人任务流程后导出,
// 这里不再手写任务对象,避免把后端不可能产生的状态组合"造"出来。
type Flow = {
  actors: Record<string, { id: string; did: string; handle: string; nickname: string }>
  steps: Array<{ name: string; viewers: Record<string, RiceTask> }>
}
const flow = JSON.parse(readFileSync(new URL('./__fixtures__/multi-task-flow.json', import.meta.url), 'utf8')) as Flow

const state = vi.hoisted(() => ({ session: null as RiceSession | null }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: state.session, isReady: true }) }))
vi.mock('../session/LoginLink', () => ({ LoginLink: ({ children }: { children: ReactNode }) => <a>{children}</a> }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

function render(step: string, viewer: string) {
  const task = flow.steps.find((item) => item.name === step)?.viewers[viewer]
  if (!task) throw new Error(`fixture 里没有 ${step}/${viewer}`)
  const actor = flow.actors[viewer]
  state.session = actor ? ({ token: 'token', user: { id: actor.id, did: actor.did, handle: actor.handle } } as RiceSession) : null
  const html = renderToStaticMarkup(<TaskDetailPage taskId={task.id} initial={{ task, error: '', viewerToken: actor ? 'token' : null }} />)
  return { task, html }
}

it('published: 管理员能取消,路人能申请,未登录只看到登录入口', () => {
  expect(render('published', 'manager').html).toContain('取消任务')
  expect(render('published', 'worker_a').html).toContain('申请承接')
  const anonymous = render('published', 'anonymous').html
  expect(anonymous).toContain('登录后申请承接')
  expect(anonymous).not.toContain('申请承接" ')
})

it('applied: 申请人看到等待确认,管理员看到三份待审批申请', () => {
  expect(render('applied', 'worker_c').html).toContain('申请已提交，等发起人确认')
  const manager = render('applied', 'manager').html
  expect(manager).toContain('待审批申请')
  expect(manager.match(/拒绝申请/g)).toHaveLength(3)
  expect(manager).toContain('微信 住得近')
  // 申请人之间看不到彼此的联系方式
  expect(render('applied', 'worker_b').html).not.toContain('微信 住得近')
})

it('appointed: 名额满后承接者能交成果,落选者看到未入选,管理员能撤销和提前结束', () => {
  const a = render('appointed', 'worker_a')
  expect(a.html).toContain('<h2>交成果</h2>')
  expect(myTaskGroup(a.task, false)).toBe('in_progress')
  const c = render('appointed', 'worker_c')
  expect(c.html).toContain('本次申请未入选')
  expect(myTaskGroup(c.task, false)).toBe('not_selected')
  const manager = render('appointed', 'manager').html
  expect(manager).toContain('承接中')
  expect(manager.match(/撤销指派/g)).toHaveLength(2)
  expect(manager).toContain('提前取消任务')
  expect(manager).not.toContain('待审批申请')
  expect(render('appointed', 'guest').html).not.toContain('申请承接')
})

it('released: 被撤销的人看到提示,落选者重新排队,管理员重新看到待审批', () => {
  const a = render('released', 'worker_a')
  expect(a.html).toContain('撤销了对你的指派')
  expect(a.html).not.toContain('<h2>交成果</h2>')
  expect(myTaskGroup(a.task, false)).toBe('not_selected')
  expect(render('released', 'worker_c').html).toContain('申请已提交，等发起人确认')
  const manager = render('released', 'manager').html
  expect(manager).toContain('待审批申请')
  expect(manager.match(/撤销指派/g)).toHaveLength(1)
})

it('submitted: 管理员按人验收,有待验收成果时没有提前结束;承接者各看各的进度', () => {
  const manager = render('submitted', 'manager').html
  expect(manager).toContain('小林的提交')
  expect(manager).toContain('通过并发放稻米')
  expect(manager).not.toContain('提前取消任务')
  expect(render('submitted', 'worker_b').html).toContain('待验收')
  const c = render('submitted', 'worker_c')
  expect(c.html).toContain('我的进度：进行中')
  expect(c.html).toContain('<h2>交成果</h2>')
  expect(c.html).not.toContain('小林的提交')
})

it('approved: 通过验收的人看到自己已完成和已到账,其他人照常继续', () => {
  const b = render('approved', 'worker_b')
  expect(b.html).toContain('我的进度：已完成')
  expect(b.html).toContain('30 稻米已发放到你的账户')
  expect(b.html).not.toContain('<h2>交成果</h2>')
  expect(myTaskGroup(b.task, false)).toBe('completed')
  const c = render('approved', 'worker_c')
  expect(c.html).toContain('<h2>交成果</h2>')
  expect(myTaskGroup(c.task, false)).toBe('in_progress')
  expect(render('approved', 'manager').html).toContain('提前取消任务')
})

it('closed: 任务完成,没有任何动作;被撤销的人和已完成的人各自看到结果', () => {
  const manager = render('closed', 'manager').html
  expect(manager).toContain('稻米激励已发放')
  for (const action of ['撤销指派', '提前取消任务', '通过并发放稻米', '编辑任务']) expect(manager).not.toContain(action)
  expect(render('closed', 'worker_c').html).toContain('撤销了对你的指派')
  const b = render('closed', 'worker_b')
  expect(b.html).toContain('验收通过')
  expect(myTaskGroup(b.task, false)).toBe('completed')
})
