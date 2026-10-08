import { Link, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, Bell, Search } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  getNotifications,
  getTaskNotifications,
  NOTIFICATIONS_READ_EVENT,
} from '~/features/notifications/api'
import { applyNotificationState, NOTIFICATION_STORAGE_PREFIX } from '~/features/notifications/local-state'
import { loginReturnTo } from '~/features/session/login-redirect'
import { LoadingProgress } from './LoadingProgress'
import { LoadingState } from './LoadingState'
import { useStoredSession } from '~/features/session/session'

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const { session, isReady, recoveryError } = useStoredSession()
  const previousSession = useRef<{ accountId?: string; token?: string } | null>(null)
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false)
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname.replace(/\/+$/, '') || '/' })
  const navigating = useRouterState({ select: (state) => state.isLoading && state.location.href !== state.resolvedLocation?.href })
  const href = useRouterState({ select: (state) => state.location.href })
  useEffect(() => {
    const refresh = () => { void router.invalidate({ filter: (match) => ['/tasks/', '/events', '/me/', '/me/tasks'].includes(match.routeId) }) }
    window.addEventListener('rice-changed', refresh)
    return () => window.removeEventListener('rice-changed', refresh)
  }, [router])
  useEffect(() => {
    if (!isReady) return
    const previous = previousSession.current
    if (previous && (previous.accountId !== session?.user.id || previous.token !== session?.token)) {
      router.clearCache({ filter: (match) => match.routeId === '/me/' || match.routeId === '/me/tasks' })
      void router.invalidate({ filter: (match) => match.routeId === '/me/' || match.routeId === '/me/tasks' })
    }
    previousSession.current = { accountId: session?.user.id, token: session?.token }
  }, [router, isReady, session?.user.id, session?.token])
  const isMainPage = ['/', '/tasks', '/events', '/me'].includes(pathname)
  const isGrainPage = pathname === '/me/grains' || pathname.startsWith('/me/grains/')
  const nodeChild = pathname.match(/^\/nodes\/([^/]+)\/(?:tasks|events|grains)$/)
  const profileChild = pathname.match(/^\/profile\/([^/]+)\/(?:followers|following)$/)
  const parentPage = pathname.startsWith('/tasks/') ? '/tasks'
    : pathname.startsWith('/events/') ? '/events'
    : !session && pathname.startsWith('/me/') ? '/me'
    : pathname === '/me/grains/send/scan' ? '/me/grains/send'
    : pathname.startsWith('/me/settings/') ? '/me/settings'
    : pathname.startsWith('/me/') ? '/me'
    : pathname.startsWith('/alliance/') ? '/alliance'
    : pathname === '/alliance' ? '/me'
    : pathname.startsWith('/nodes/') ? '/alliance/nodes'
    : pathname === '/register' || pathname === '/forgot-password' ? '/login'
    : pathname.startsWith('/profile/') ? '/'
    : pathname === '/compose' && href.includes('kind=task') ? '/tasks'
    : pathname === '/compose' && href.includes('kind=activity') ? '/events'
    : '/'
  const goBack = () => {
    if (isGrainPage) void router.navigate({ to: parentPage, replace: true })
    else if (canGoBack) router.history.back()
    else if (pathname === '/register') void router.navigate({ to: '/login', search: { returnTo: loginReturnTo(new URLSearchParams(href.split('?')[1] ?? '').get('returnTo')) }, replace: true })
    else if (nodeChild) void router.navigate({ to: '/nodes/$nodeId', params: { nodeId: decodeURIComponent(nodeChild[1]) }, replace: true })
    else if (profileChild) void router.navigate({ to: '/profile/$actor', params: { actor: decodeURIComponent(profileChild[1]) }, replace: true })
    else void router.navigate({ to: parentPage, replace: true })
  }

  useEffect(() => {
    if (!isReady || !isMainPage) return
    if (!session) {
      setHasUnreadNotifications(false)
      return
    }

    let active = true
    const refresh = async () => {
      const results = await Promise.allSettled([
        getNotifications({ data: { token: session.pds.access_jwt } }),
        getTaskNotifications({ data: { token: session.token } }),
      ])
      if (!active) return

      const hasUnread = results.some(
        (result) =>
          result.status === 'fulfilled' && applyNotificationState(session.pds.did, result.value.notifications).some((item) => !item.isRead),
      )
      if (hasUnread || results.every((result) => result.status === 'fulfilled')) {
        setHasUnreadNotifications(hasUnread)
      }
    }
    const storageChanged = (event: StorageEvent) => {
      if (!event.key || event.key === `${NOTIFICATION_STORAGE_PREFIX}${session.pds.did}`) void refresh()
    }

    void refresh()
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener(NOTIFICATIONS_READ_EVENT, refresh)
    window.addEventListener('storage', storageChanged)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, refresh)
      window.removeEventListener('storage', storageChanged)
    }
  }, [isReady, isMainPage, session?.token, session?.pds?.access_jwt])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          {isMainPage ? <Link to="/" className="brand" aria-label="返回乡建 DAO 广场">
            <img src="/site-icon.png" alt="乡建 DAO" />
          </Link> : <button type="button" className="child-back" aria-label="返回上一页" onClick={goBack}><ArrowLeft size={24} aria-hidden="true" /></button>}
          {isMainPage && <div className="topbar-actions">
            {!isReady && <span className="session-placeholder" aria-hidden="true" />}
            {isReady && session && <Link to="/compose" search={{ kind: pathname === '/tasks' ? 'task' : pathname === '/events' ? 'activity' : 'post' }} className="header-publish">发布</Link>}
            {isReady && !session && <Link to="/login" search={{ returnTo: href }} className="header-publish">登录</Link>}
            <Link to="/search" className="header-search" aria-label="搜索帖子、任务、活动、节点、用户"><Search size={22} aria-hidden="true" /></Link>
            {isReady && session && <Link to="/notifications" className="header-search notification-trigger" aria-label={hasUnreadNotifications ? '通知，有新消息' : '通知'}><Bell size={22} aria-hidden="true" />{hasUnreadNotifications && <i className="notification-dot" aria-hidden="true" />}</Link>}
          </div>}
        </div>
      </header>

      <main key={session?.user.id ?? 'guest'} className={pathname === '/compose' ? 'page-frame compose-frame' : 'page-frame'}>{recoveryError && <p className="inline-error" role="alert">{recoveryError}</p>}{isReady ? children : <LoadingState label="正在恢复登录状态" className="page initial-loading loading-line" />}</main>
      {navigating && <LoadingProgress label="正在加载页面…" />}

      <nav className="bottom-nav" aria-label="主要导航">
        <Link to="/" activeProps={{}} className={`bottom-link${pathname === '/' ? ' active' : ''}`}>
          广场
        </Link>
        <Link
          to="/tasks"
          activeProps={{}}
          className={`bottom-link${pathname.startsWith('/tasks') ? ' active' : ''}`}
        >
          任务
        </Link>
        <Link to="/events" activeProps={{}} className={`bottom-link${pathname.startsWith('/events') ? ' active' : ''}`}>活动</Link>
        <Link
          to="/me"
          activeProps={{}}
          className={`bottom-link${pathname.startsWith('/me') ? ' active' : ''}`}
        >
          我的
        </Link>
      </nav>
    </div>
  )
}
