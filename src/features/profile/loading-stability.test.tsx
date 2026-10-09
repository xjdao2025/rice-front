import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RiceSession, RiceUser } from '~/lib/models'

const state = vi.hoisted(() => ({ session: null as RiceSession | null, saveSession: vi.fn(), navigate: vi.fn(), logout: vi.fn(), logoutAction: undefined as (() => Promise<void>) | undefined }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: state.session, isReady: true, saveSession: state.saveSession }) }))
vi.mock('../session/api', async (original) => ({ ...await original<typeof import('../session/api')>(), logoutRice: state.logout }))
vi.mock('@astryxdesign/core/Button', () => ({ Button: ({ label, clickAction }: { label: string; clickAction?: () => Promise<void> }) => {
  if (label === '退出登录') state.logoutAction = clickAction
  return <button>{label}</button>
} }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => state.navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { ProfilePage, type ProfileInitialData } from './ProfilePage'
import { SiteFooter } from '~/components/SiteFooter'
import { MyTasksPage } from '../tasks/MyTasksPage'
import type { RiceTask } from '../tasks/types'
import { GrainHistoryPage } from '../grains/GrainHistoryPage'

const user = { id: 'member', did: 'did:example:member', handle: 'member.test', nickname: '当前用户', bio: '个人简介', avatar: null } as RiceUser
const initialData: ProfileInitialData = { accountId: user.id, sessionToken: 'token', user, wallet: { balance: 123, frozen: 7, earned: 140, entries: [] } }
beforeEach(() => {
  vi.clearAllMocks()
  state.logout.mockResolvedValue(true)
  state.logoutAction = undefined
  state.session = { token: 'token', user, pds: { did: user.did } } as RiceSession
})

it('clears the session without starting a late homepage navigation over the personal login form', async () => {
  renderToStaticMarkup(<ProfilePage initialData={initialData} />)
  await state.logoutAction!()
  expect(state.logout).toHaveBeenCalledWith({ data: 'token' })
  expect(state.saveSession).toHaveBeenCalledWith(null)
  expect(state.navigate).not.toHaveBeenCalled()
})

it('renders the prefetched profile and balance together on first render', () => {
  const html = renderToStaticMarkup(<ProfilePage initialData={initialData} />)
  expect(html).toContain('当前用户')
  expect(html).toContain('<strong>130</strong>')
  expect(html).toContain('<b>123</b>')
  expect(html).toContain('href="/me/posts"')
  expect(html).not.toContain('href="/alliance"')
  expect(html).not.toContain('>—<')
  expect(html).not.toContain('节点稻米')
})

it('shows the contact email at the bottom; policies and ICP come from the site footer', () => {
  const html = renderToStaticMarkup(<ProfilePage initialData={initialData} />)
  expect(html).toContain('href="mailto:xjdaos@126.com"')
  expect(html).toContain('Powered by XJDAO')
  expect(html).not.toContain('京ICP备')
})

it('puts the policy links and ICP filing in the site footer', () => {
  const html = renderToStaticMarkup(<SiteFooter />)
  expect(html).toContain('隐私政策</a> • <a')
  expect(html).toContain('%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96.pdf')
  expect(html).toContain('%E7%94%A8%E6%88%B7%E6%9C%8D%E5%8A%A1%E5%8D%8F%E8%AE%AE.pdf')
  expect(html).toContain('href="https://beian.miit.gov.cn/"')
  expect(html).toContain('京ICP备2025136647号')
})

it('offers the community switch alongside the personal balance only for the current session', () => {
  const adminData = { ...initialData, communities: [{ id: 'community', name: '测试社区', wallet: { ...initialData.wallet, balance: 500 } }] }
  const html = renderToStaticMarkup(<ProfilePage initialData={adminData} />)
  expect(html).toContain('我的测试稻米')
  expect(html).toContain('节点稻米')
  expect(html).toContain('<strong>130</strong>')
  expect(html).not.toContain('<strong>507</strong>')
  expect(renderToStaticMarkup(<ProfilePage initialData={{ ...adminData, sessionToken: 'old-session' }} />)).not.toContain('节点稻米')
})

it('does not display another account’s prefetched profile or balance', () => {
  const html = renderToStaticMarkup(<ProfilePage initialData={{ ...initialData, accountId: 'other', user: { ...user, nickname: '其他账号' } }} />)
  expect(html).toContain('当前用户')
  expect(html).not.toContain('其他账号')
  expect(html).not.toContain('<b>123</b>')
})

it('does not reuse a balance from an earlier login to the same account', () => {
  const html = renderToStaticMarkup(<ProfilePage initialData={{ ...initialData, sessionToken: 'old-session' }} />)
  expect(html).toContain('当前用户')
  expect(html).not.toContain('<b>123</b>')
})

it('does not guess task filters or zero counts before the personal history has loaded', () => {
  const html = renderToStaticMarkup(<MyTasksPage />)
  expect(html).toContain('正在加载任务')
  expect(html).not.toContain('我的任务筛选')
  expect(html).not.toContain('这里还没有任务')
})

it('renders the prefetched personal task filter on the first paint', () => {
  const html = renderToStaticMarkup(<MyTasksPage initialData={{ accountId: 'member', sessionToken: 'token', tasks: [] }} />)
  expect(html).toContain('我的任务筛选')
  expect(html).toContain('全部任务 0')
  expect(html).toContain('这里还没有任务')
  expect(html).not.toContain('正在加载任务')
})

it('shows separate task states and counts in the native filter', () => {
  const task = (id: string, status: RiceTask['status'], creator = user, my_application_status: RiceTask['my_application_status'] = null) => ({
    id, title: id, status, creator, my_application_status, reward_amount: 1, application_deadline: null,
  }) as unknown as RiceTask
  const tasks = [
    task('招募任务', 'open'), task('超时任务', 'overdue'),
    { ...task('临期任务', 'in_progress'), execution_deadline: '2026-09-21T09:00:00Z' },
    { ...task('验收任务', 'under_review'), execution_deadline: '2026-09-21T09:00:00Z' },
    task('完成任务', 'completed'), task('未入选任务', 'completed', { ...user, id: 'publisher' }, 'not_selected'),
  ]
  const html = renderToStaticMarkup(<MyTasksPage initialData={{ accountId: 'member', sessionToken: 'token', tasks }} />)
  expect(html).toContain('<select aria-label="我的任务筛选"')
  expect(html).toContain('招募中 1')
  expect(html).toContain('已超时 2')
  expect(html).toContain('进行中 0')
  expect(html).toContain('待验收 1')
  expect((html.match(/status-overdue/g) ?? []).length).toBe(2)
  expect(html).toContain('已完成 1')
  expect(html).toContain('未入选 1')
  expect(html).not.toContain('审核中')
  expect(html).not.toContain('已结束')
})

it('loads wallet history for the current route instead of reusing the profile balance', () => {
  const html = renderToStaticMarkup(<GrainHistoryPage nodeId="community" />)
  expect(html).toContain('节点稻米')
  expect(html).toContain('正在加载记录')
  expect(html).not.toContain('<strong>130</strong>')
})
