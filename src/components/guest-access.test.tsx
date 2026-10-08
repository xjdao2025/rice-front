import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'

const state = vi.hoisted(() => ({ session: null as RiceSession | null, pathname: '/', resolvedPathname: '', isLoading: false, isReady: true, canGoBack: false, navigate: vi.fn(), back: vi.fn() }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [initial, vi.fn()],
}))
vi.mock('~/features/session/session', () => ({ useStoredSession: () => ({ session: state.session, isReady: state.isReady, saveSession: vi.fn() }) }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, 'aria-label': label }: { children: ReactNode; to: string; className?: string; 'aria-label'?: string }) => <a href={to} className={className} aria-label={label}>{children}</a>,
  useNavigate: () => vi.fn(),
  useCanGoBack: () => state.canGoBack,
  useBlocker: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn(), history: { back: state.back }, navigate: state.navigate }),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string; href: string }; resolvedLocation: { pathname: string; href: string }; isLoading: boolean }) => unknown }) => select({ location: { pathname: state.pathname, href: state.pathname }, resolvedLocation: { pathname: state.resolvedPathname || state.pathname, href: state.resolvedPathname || state.pathname }, isLoading: state.isLoading }),
}))
vi.mock('~/features/notifications/api', () => ({ getNotifications: vi.fn(), getTaskNotifications: vi.fn(), NOTIFICATIONS_READ_EVENT: 'read' }))
vi.mock('~/features/notifications/NotificationsPage', () => ({ NotificationsPage: () => null }))
vi.mock('~/features/feed/ComposePanel', () => ({ ComposePanel: () => null }))
vi.mock('~/features/feed/api', () => ({ clearCachedFeed: vi.fn(), deletePost: vi.fn(), hideDeletedPost: vi.fn(), toggleLike: vi.fn(), toggleRepost: vi.fn() }))

import { AppShell } from './AppShell'

beforeEach(() => { state.session = null; state.pathname = '/'; state.resolvedPathname = ''; state.isLoading = false; state.isReady = true; state.canGoBack = false; state.navigate.mockClear(); state.back.mockClear() })

function clickBack(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(child => clickBack(child))
  if (!isValidElement<Record<string, unknown>>(node)) return false
  if (node.props['aria-label'] === '返回上一页') { (node.props.onClick as () => void)(); return true }
  return clickBack(node.props.children as ReactNode)
}

describe('child-page back navigation', () => {
  it.each(['/me/grains', '/me/grains/send', '/me/grains/receive'])('returns %s directly to My with or without earlier history', pathname => {
    state.pathname = pathname
    state.session = { user: { id: 'member' } } as RiceSession
    for (const canGoBack of [false, true]) {
      state.canGoBack = canGoBack
      expect(clickBack(AppShell({ children: null }))).toBe(true)
      expect(state.navigate).toHaveBeenLastCalledWith({ to: '/me', replace: true })
      expect(state.back).not.toHaveBeenCalled()
    }
  })

  it('returns the scanner to the send form and keeps ordinary detail history navigation', () => {
    state.session = { user: { id: 'member' } } as RiceSession
    state.canGoBack = true; state.pathname = '/me/grains/send/scan'
    clickBack(AppShell({ children: null }))
    expect(state.navigate).toHaveBeenLastCalledWith({ to: '/me/grains/send', replace: true })
    state.pathname = '/posts'; state.navigate.mockClear()
    clickBack(AppShell({ children: null }))
    expect(state.back).toHaveBeenCalledOnce()
    expect(state.navigate).not.toHaveBeenCalled()
  })

  it('replaces a direct-entry detail with its parent so Back cannot bounce between the two', () => {
    state.pathname = '/nodes/node-id/grains'
    clickBack(AppShell({ children: null }))
    expect(state.navigate).toHaveBeenCalledWith({ to: '/nodes/$nodeId', params: { nodeId: 'node-id' }, replace: true })
  })
})

describe('guest access', () => {
  it('does not flash guest controls or mount content before session restoration', () => {
    state.isReady = false
    const html = renderToStaticMarkup(<AppShell><p>content</p></AppShell>)
    expect(html).not.toContain('href="/login"')
    expect(html).not.toContain('<p>content</p>')
    expect(html).toContain('正在恢复登录状态')
  })

  it('keeps the shared brand and current navigation selected while the next route loads', () => {
    state.pathname = '/events'; state.resolvedPathname = '/tasks'; state.isLoading = true
    const html = renderToStaticMarkup(<AppShell><p>current tasks</p></AppShell>)
    expect(html).toContain('<img src="/site-icon.png" alt="乡建 DAO"/>')
    expect(html).toContain('href="/tasks" class="bottom-link active"')
    expect(html).toContain('href="/events" class="bottom-link"')
    expect(html).toContain('正在加载页面…')
  })

  it('shows login and public navigation without publishing or notifications for a guest', () => {
    const html = renderToStaticMarkup(<AppShell><p>public content</p></AppShell>)
    expect(html).toContain('href="/login"')
    expect(html).toContain('public content')
    expect(html).toContain('href="/search"')
    expect(html).not.toContain('>发布</button>')
    expect(html).not.toContain('aria-label="通知"')
  })

  it('keeps the authenticated publish control on the personal page', () => {
    state.pathname = '/me'
    state.session = { user: { id: 'member' } } as RiceSession
    const html = renderToStaticMarkup(<AppShell>{null}</AppShell>)
    expect(html).toContain('href="/compose"')
    expect(html).toContain('aria-label="通知"')
    expect(html).not.toContain('href="/login"')
  })

  it('keeps the four main destinations available on a child page', () => {
    state.pathname = '/posts'
    const html = renderToStaticMarkup(<AppShell><p>post detail</p></AppShell>)
    expect(html).toContain('aria-label="返回上一页"')
    expect(html).toContain('aria-label="主要导航"')
    for (const path of ['/', '/tasks', '/events', '/me']) expect(html).toContain(`href="${path}"`)
  })
})
