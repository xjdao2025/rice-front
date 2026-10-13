import { existsSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RiceSession, RiceUser } from '~/lib/models'

const state = vi.hoisted(() => ({ session: null as RiceSession | null, saveSession: vi.fn(), navigate: vi.fn(), logout: vi.fn(), logoutAction: undefined as (() => Promise<void>) | undefined, selectorOptions: [] as Array<{ value: string; label: string }> }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: state.session, isReady: true, saveSession: state.saveSession }) }))
vi.mock('../session/api', async (original) => ({ ...await original<typeof import('../session/api')>(), logoutRice: state.logout }))
vi.mock('@astryxdesign/core/Button', () => ({ Button: ({ label, clickAction }: { label: string; clickAction?: () => Promise<void> }) => {
  if (label === '退出登录') state.logoutAction = clickAction
  return <button>{label}</button>
} }))
vi.mock('@astryxdesign/core/Selector', async (original) => {
  const actual = await original<typeof import('@astryxdesign/core/Selector')>()
  return { ...actual, Selector: (props: Parameters<typeof actual.Selector>[0]) => {
    state.selectorOptions = props.options as Array<{ value: string; label: string }>
    return <actual.Selector {...props} />
  } }
})
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: { actor?: string } }) => <a href={to.replace('$actor', params?.actor ?? '$actor')}>{children}</a>,
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
  state.selectorOptions = []
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
  expect(html).toContain('href="/profile/did:example:member/following"')
  expect(html).toContain('href="/profile/did:example:member/followers"')
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
  // 文件在 public/doc，随前端一起发布
  for (const doc of ['privacy', 'terms']) {
    expect(html).toContain(`href="/doc/${doc}.pdf"`)
    expect(existsSync(`public/doc/${doc}.pdf`)).toBe(true)
  }
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
  expect(html).toContain('role="combobox"')
  expect(html).toContain('aria-haspopup="listbox"')
  expect(html.replace(/<[^>]*>/g, '')).toContain('全部 0')
  expect(html).toContain('这里还没有任务')
  expect(html).not.toContain('正在加载任务')
})

it('provides separate task states and counts to the library filter', () => {
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
  expect(state.selectorOptions).toEqual(expect.arrayContaining([
    { value: 'all', label: '全部 6' },
    { value: 'open', label: '招募中 1' },
    { value: 'overdue', label: '已超时 2' },
    { value: 'in_progress', label: '进行中 0' },
    { value: 'under_review', label: '待验收 1' },
    { value: 'completed', label: '已完成 1' },
    { value: 'not_selected', label: '未入选 1' },
  ]))
  expect((html.match(/status-overdue/g) ?? []).length).toBe(2)
  expect(state.selectorOptions.some(option => /审核中|已结束/.test(option.label))).toBe(false)
  expect(html).not.toContain('审核中')
  expect(html).not.toContain('已结束')
})

it('loads wallet history for the current route instead of reusing the profile balance', () => {
  const html = renderToStaticMarkup(<GrainHistoryPage nodeId="community" />)
  expect(html).toContain('节点稻米')
  expect(html).toContain('正在加载记录')
  expect(html).not.toContain('<strong>130</strong>')
})
