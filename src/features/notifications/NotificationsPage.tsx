import { Button } from '@astryxdesign/core/Button'
import { useNavigate } from '@tanstack/react-router'
import { Bell, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AutoLoadMore } from '~/components/AutoLoadMore'
import { LoadingState } from '~/components/LoadingState'
import { authorDisplayName, formatTimestamp } from '~/lib/format'
import { businessCopy } from '~/lib/business-copy'
import type { NotificationView, RiceSession } from '~/lib/models'

import { useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import {
  getNotifications,
  getTaskNotifications,
  markNotificationsRead,
  markTaskNotificationsRead,
  NOTIFICATIONS_READ_EVENT,
  notificationTarget,
  type NotificationTarget,
} from './api'
import { applyNotificationState, mergeNotificationRows, notificationSource, NOTIFICATION_STORAGE_PREFIX, saveNotificationState } from './local-state'

const reasonCopy: Record<string, { label: string; action: string }> = {
  like: { label: '点赞', action: '赞了你的帖子' },
  repost: { label: '转发', action: '转发了你的帖子' },
  follow: { label: '关注', action: '关注了你' },
  mention: { label: '提及', action: '在帖子中提到了你' },
  reply: { label: '评论', action: '回复了你的帖子' },
  quote: { label: '引用', action: '引用了你的帖子' },
  'subscribed-post': { label: '帖子', action: '发布了新帖子' },
  'task-application_created': { label: '任务', action: '申请领取你的任务' },
  'task-assignee_appointed': { label: '任务', action: '任命你承做任务' },
  'task-application_not_selected': { label: '任务', action: '通知你：本次任务申请未入选' },
  'task-application_rejected': { label: '任务', action: '拒绝了你的任务申请，本次申请未入选' },
  'task-task_cancelled': { label: '任务', action: '取消了你申请的任务' },
  'task-task_expired': { label: '任务', action: '你申请的任务已失效' },
  'task-result_submitted': { label: '任务', action: '提交了任务结果' },
  'task-result_approved': { label: '任务', action: '认可了你的任务结果' },
  'task-changes_requested': { label: '任务', action: '请你继续完善任务结果' },
}

export function notificationTitle(notification: NotificationView) {
  if (notification.subjectType && notification.subjectType !== 'task') return businessCopy(notification.text) || '有新的业务通知'
  return `${authorDisplayName(notification.author)} ${reasonCopy[notification.reason]?.action || '与你有新的互动'}`
}

export function NotificationsPage() {
  const { session, isReady } = useStoredSession()
  return <NotificationInbox key={session?.pds.did ?? 'guest'} session={session} isReady={isReady} />
}

function NotificationInbox({ session, isReady }: { session: RiceSession | null; isReady: boolean }) {
  const navigate = useNavigate()
  const [marking, setMarking] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [rows, setRows] = useState<NotificationView[]>([])
  const [cursors, setCursors] = useState<{ social: string | null; business: string | null }>({ social: null, business: null })
  const [isLoading, setLoading] = useState(true)
  const [paging, setPaging] = useState(false)
  const [pagingError, setPagingError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [clearError, setClearError] = useState('')
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [, refreshLocalState] = useState(0)
  const accessJwt = session?.pds.access_jwt
  const riceToken = session?.token
  const account = session?.pds.did
  const notifications = account ? applyNotificationState(account, rows) : []
  const lifetime = useRef(0)
  const loadRequest = useRef(0)

  useEffect(() => {
    const refresh = () => refreshLocalState((value) => value + 1)
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === NOTIFICATION_STORAGE_PREFIX + account) refresh()
    }
    window.addEventListener(NOTIFICATIONS_READ_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [account])

  useEffect(() => {
    lifetime.current += 1
    setMarking(false)
    setClearing(false)
    setClearError('')
    return () => { lifetime.current += 1 }
  }, [accessJwt, riceToken])

  useEffect(() => {
    if (!isReady) return
    const current = ++loadRequest.current
    setPaging(false)
    if (!accessJwt || !riceToken) {
      setRows([])
      setCursors({ social: null, business: null })
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    setPagingError('')
    void Promise.allSettled([
      getNotifications({ data: { token: accessJwt } }),
      getTaskNotifications({ data: { token: riceToken } }),
    ])
      .then(([social, tasks]) => {
        if (current !== loadRequest.current) return

        const nextNotifications = [social, tasks]
          .flatMap((result) => result.status === 'fulfilled' ? result.value.notifications : [])
        setRows(mergeNotificationRows([], nextNotifications))
        setCursors({
          social: social.status === 'fulfilled' ? social.value.cursor : null,
          business: tasks.status === 'fulfilled' ? tasks.value.cursor : null,
        })

        setLoadError(([
          ['帖子互动通知', social], ['任务、活动与节点通知', tasks],
        ] as const).flatMap(([source, result]) => result.status === 'rejected'
          ? [`${source}暂时无法加载：${result.reason instanceof Error ? result.reason.message : '请稍后重试。'}`]
          : []).join(' '))
      })
      .finally(() => {
        if (current === loadRequest.current) setLoading(false)
      })
    return () => { loadRequest.current++ }
  }, [accessJwt, isReady, reloadKey, riceToken])

  const hasMore = Boolean(cursors.social || cursors.business)
  const more = async () => {
    if (!accessJwt || !riceToken || !hasMore || isLoading || paging || marking || clearing) return
    const current = loadRequest.current
    const sources: Array<'social' | 'business'> = (['social', 'business'] as const).filter((source) => Boolean(cursors[source]))
    setPaging(true); setPagingError('')
    const results = await Promise.allSettled(sources.map((source) => source === 'social'
      ? getNotifications({ data: { token: accessJwt, cursor: cursors.social ?? undefined } })
      : getTaskNotifications({ data: { token: riceToken, cursor: cursors.business ?? undefined } })))
    if (current !== loadRequest.current) return
    const next = { ...cursors }
    const received: NotificationView[] = []
    const failures: string[] = []
    sources.forEach((source, index) => {
      const result = results[index]
      if (result.status === 'rejected') {
        failures.push(`${source === 'social' ? '帖子互动通知' : '任务、活动与节点通知'}暂时无法加载更多：${result.reason instanceof Error ? result.reason.message : '请稍后重试。'}`)
      } else if (result.value.cursor && result.value.cursor === cursors[source]) {
        failures.push('通知分页游标未更新，请重试。')
      } else {
        received.push(...result.value.notifications)
        next[source] = result.value.cursor
      }
    })
    setRows((currentRows) => mergeNotificationRows(currentRows, received))
    setCursors(next)
    setPagingError(failures.join(' '))
    setPaging(false)
  }

  const markAll = async () => {
    if (!accessJwt || !riceToken || isLoading || paging || marking || clearing) return
    const requestLifetime = lifetime.current
    setMarking(true); setReadError(''); setError('')
    const results = await Promise.allSettled([markNotificationsRead({ data: accessJwt }), markTaskNotificationsRead({ data: riceToken })])
    if (requestLifetime !== lifetime.current) return
    setRows((current) => current.map((notification) =>
      results[notificationSource(notification) === 'social' ? 0 : 1].status === 'fulfilled'
        ? { ...notification, isRead: true } : notification))
    setReadError(results.flatMap((result, index) => result.status === 'rejected'
      ? [`${index === 0 ? '帖子互动通知' : '任务、活动与节点通知'}未能标记已读：${result.reason instanceof Error ? result.reason.message : '请稍后重试。'}`] : []).join(' '))
    window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT))
    setMarking(false)
  }

  const saveLocalState = (items: NotificationView[], state: 'read' | 'hidden') => {
    if (!account) return
    try {
      saveNotificationState(account, items, state)
      setError('')
    } catch { setError(state === 'hidden' ? '未能清除已读消息，请检查浏览器存储后重试。' : '未能保存已读状态，请检查浏览器存储后重试。') }
  }

  const clearAllRead = async () => {
    if (!account || !accessJwt || !riceToken || isLoading || paging || marking || clearing) return
    const current = lifetime.current
    setClearing(true); setClearError('')
    try {
      const all: NotificationView[] = []
      const sources: Array<{ load: typeof getNotifications; token: string; name: string; cursor?: string | null }> = [
        { load: getNotifications, token: accessJwt, name: '帖子通知' },
        { load: getTaskNotifications, token: riceToken, name: '业务通知' },
      ]
      while (sources.some((source) => source.cursor !== null)) {
        const pages = await Promise.all(sources.map((source) => source.cursor === null ? null
          : source.load({ data: { token: source.token, cursor: source.cursor } })))
        if (current !== lifetime.current) return
        sources.forEach((source, index) => {
          const page = pages[index]
          if (!page) return
          all.push(...page.notifications)
          if (page.cursor && page.cursor === source.cursor) throw new Error(`${source.name}分页未前进`)
          source.cursor = page.cursor
        })
      }
      saveNotificationState(account, applyNotificationState(account, all).filter((notification) => notification.isRead), 'hidden')
    } catch (reason) {
      if (current === lifetime.current) setClearError(`未能清除已读消息：${reason instanceof Error ? reason.message : '请稍后重试。'}`)
    } finally { if (current === lifetime.current) setClearing(false) }
  }

  const unreadCount = notifications.filter((notification) => !notification.isRead).length
  const openTarget = (target: NotificationTarget) => {
    if (target.kind === 'task') void navigate({ to: '/tasks/$taskId', params: { taskId: target.id } })
    else if (target.kind === 'event') void navigate({ to: '/events/$eventId', params: { eventId: target.id } })
    else if (target.kind === 'node') void navigate({ to: '/nodes/$nodeId', params: { nodeId: target.id } })
    else if (target.kind === 'post') void navigate({ to: '/posts', search: { uri: target.uri } })
    else if (target.kind === 'profile') void navigate({ to: '/profile/$actor', params: { actor: target.actor } })
  }

  if (isReady && !session) {
    return (
      <div className="page signed-out-state">
        <Bell size={34} aria-hidden="true" />
        <strong>登录后查看通知</strong>
        <p>新的互动会集中显示在这里。</p>
        <LoginLink className="primary-link">前往登录</LoginLink>
      </div>
    )
  }

  return (
    <div className="page notifications-page">
      <div className="business-heading notification-heading">
        <div><h1>通知</h1>{unreadCount > 0 && <span className="notification-count">{unreadCount} 条未读</span>}</div>
        <div className="notification-actions">
          <Button label={marking ? '正在标记…' : '全部已读'} variant="ghost" isDisabled={isLoading || paging || marking || clearing || (!unreadCount && !hasMore)} clickAction={markAll} />
          <Button label="清除已读" variant="ghost" isLoading={clearing} isDisabled={isLoading || paging || marking || clearing || (!notifications.some((notification) => notification.isRead) && !hasMore)} clickAction={clearAllRead} />
        </div>
      </div>
      {loadError || readError || clearError || error ? (
        <div className="inline-error" role="alert">
          <span>{[loadError, readError, clearError, error].filter(Boolean).join(' ')}</span>
          {(loadError || readError || clearError) && <Button label="重试" variant="ghost" size="sm" isDisabled={marking || clearing} onClick={async () => {
            if (clearError) { await clearAllRead(); return }
            if (readError) await markAll()
            if (loadError || !readError) setReloadKey((value) => value + 1)
          }} />}
        </div>
      ) : null}

      {notifications.length === 0 && !isLoading && !loadError && !readError && !hasMore ? (
        <section className="notification-empty-state">
          <Bell size={28} aria-hidden="true" />
          <strong>暂时没有通知</strong>
        </section>
      ) : (
        <section className="notification-list" aria-label="通知列表">
          {notifications.map((notification) => {
            const target = notificationTarget(notification)
            const previewText = notification.subjectType ? businessCopy(notification.text) : notification.text
            return <button
              className={`notification-row ${notification.isRead ? '' : 'unread'}`}
              key={`${notificationSource(notification)}-${notification.uri}-${notification.reason}`}
              type="button"
              onClick={() => {
                if (!notification.isRead) saveLocalState([notification], 'read')
                if (target) openTarget(target)
              }}
            >
              <span className={`notification-reason reason-${notification.reason}`}>
                {notification.subjectType === 'event' ? '活动' : notification.subjectType === 'node' ? '节点' : reasonCopy[notification.reason]?.label || '互动'}
              </span>
              <span className="notification-body">
                <strong>{notificationTitle(notification)}</strong>
                {previewText && previewText !== notificationTitle(notification) ? <span className="notification-preview">{previewText}</span> : null}
                <span className="notification-meta"><time dateTime={notification.indexedAt}>{formatTimestamp(notification.indexedAt)}</time>{!notification.isRead && <span className="notification-unread"><i aria-hidden="true" />未读</span>}</span>
              </span>
              {target && <ChevronRight className="notification-arrow" size={20} aria-hidden="true" />}
            </button>
          })}
        </section>
      )}
      {isLoading ? <LoadingState label="正在加载通知…" /> : null}
      {pagingError && <p className="inline-error" role="alert">{pagingError}</p>}
      {hasMore && !isLoading && (notifications.length
        ? <AutoLoadMore cursor={JSON.stringify(cursors)} loading={paging || isLoading} failed={!!pagingError} onLoadMore={more} />
        : <Button label="加载更早通知" variant="secondary" isLoading={paging} isDisabled={paging || isLoading} clickAction={more} />)}
    </div>
  )
}
