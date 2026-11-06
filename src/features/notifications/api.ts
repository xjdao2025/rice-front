import { createServerFn } from '@tanstack/react-start'
import { credential, object, optional, text } from '~/lib/validation'

import { backend, BACKEND_BASE, fetchWithTimeout, readJson, searchParams, withQuery } from '~/lib/http'
import { pdsGet } from '~/lib/pds'
import type { NotificationView } from '~/lib/models'

export const NOTIFICATIONS_READ_EVENT = 'xiangjian-notifications-read'

export type NotificationTarget =
  | { kind: 'task' | 'event' | 'node'; id: string }
  | { kind: 'post'; uri: string }
  | { kind: 'profile'; actor: string }

function isPostUri(uri: string | undefined): uri is string {
  return typeof uri === 'string' && /^at:\/\/[^/\s?#]+\/app\.bsky\.feed\.post\/[^/\s?#]+$/.test(uri)
}

export function notificationTarget(notification: NotificationView): NotificationTarget | null {
  const { subjectType, subjectId, taskId, reason } = notification
  if (subjectType === 'event' || subjectType === 'node') {
    return subjectId?.trim() ? { kind: subjectType, id: subjectId } : null
  }
  if (subjectType === 'task' || (!subjectType && taskId)) {
    const id = subjectId?.trim() ? subjectId : taskId
    return id?.trim() ? { kind: 'task', id } : null
  }
  if (subjectType) return null

  if (reason === 'like' || reason === 'repost') {
    // The notification URI is the like/repost record, not the post being referenced.
    const uri = [notification.reasonSubject, notification.recordSubjectUri].find(isPostUri)
    return uri ? { kind: 'post', uri } : null
  }
  if (['reply', 'mention', 'quote', 'subscribed-post'].includes(reason)) {
    return isPostUri(notification.uri) ? { kind: 'post', uri: notification.uri } : null
  }
  if (reason === 'follow') {
    const { did, handle } = notification.author
    if (did && /^did:[a-z0-9]+:[^\s/?#]+$/i.test(did)) return { kind: 'profile', actor: did }
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(handle)) return { kind: 'profile', actor: handle }
  }
  return null
}

export function normalizeNotifications(payload: unknown): NotificationView[] {
  const body = (payload ?? {}) as {
    notifications?: Array<{
      uri?: unknown
      author?: { did?: unknown; handle?: unknown; displayName?: unknown }
      reason?: unknown
      reasonSubject?: unknown
      record?: { text?: unknown; subject?: { uri?: unknown } }
      isRead?: unknown
      indexedAt?: unknown
      taskId?: unknown
      subjectType?: unknown
      subjectId?: unknown
    }>
  }
  const str = (value: unknown) => typeof value === 'string' ? value : undefined
  // Optional keys stay absent (not undefined) when the payload lacks them.
  const optional = <K extends string>(key: K, value: unknown) =>
    typeof value === 'string' ? { [key]: value } as Record<K, string> : {}
  return (Array.isArray(body.notifications) ? body.notifications : [])
    .flatMap((notification): NotificationView[] => {
      if (notification == null || typeof notification.uri !== 'string' || typeof notification.author?.handle !== 'string') return []
      const { record } = notification
      return [{
        uri: notification.uri,
        author: { ...optional('did', notification.author.did), handle: notification.author.handle, displayName: str(notification.author.displayName) },
        reason: str(notification.reason) ?? 'unknown',
        ...optional('reasonSubject', notification.reasonSubject),
        ...optional('recordSubjectUri', record?.subject?.uri),
        text: str(record?.text) ?? '',
        isRead: notification.isRead === true,
        indexedAt: str(notification.indexedAt) ?? new Date(0).toISOString(),
        ...optional('subjectType', notification.subjectType),
        ...optional('subjectId', notification.subjectId),
        ...optional('taskId', notification.taskId),
      }]
    })
}

export type NotificationPage = { notifications: NotificationView[]; cursor: string | null }
export function normalizeNotificationPage(payload: unknown): NotificationPage {
  const body = (payload ?? {}) as { cursor?: unknown }
  return {
    notifications: normalizeNotifications(payload),
    cursor: typeof body.cursor === 'string' && body.cursor ? body.cursor : null,
  }
}

type NotificationPageInput = { token: string; cursor?: string }
export async function loadSocialNotificationPage({ token, cursor }: NotificationPageInput): Promise<NotificationPage> {
  return normalizeNotificationPage(await pdsGet<unknown>('app.bsky.notification.listNotifications', searchParams({ limit: '30', cursor }), token))
}

export async function loadBusinessNotificationPage({ token, cursor }: NotificationPageInput): Promise<NotificationPage> {
  return normalizeNotificationPage(await backend<unknown>(withQuery('/api/notifications', { before: cursor }), { token }))
}

export const getNotifications = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, cursor: optional(text(4096)) }))
  .handler(({ data }) => loadSocialNotificationPage(data))

export const getTaskNotifications = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, cursor: optional(text(4096)) }))
  .handler(({ data }) => loadBusinessNotificationPage(data))

export async function updateSeenNotifications(accessJwt: string) {
  return fetchWithTimeout(`${BACKEND_BASE}/pds/xrpc/app.bsky.notification.updateSeen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seenAt: new Date().toISOString() }),
  }, 30_000, async response => {
    // updateSeen has no output schema and returns an empty HTTP 200 on success.
    if (!response.ok) await readJson(response)
  })
}

export const markNotificationsRead = createServerFn({ method: 'POST' })
  .validator(credential)
  .handler(({ data: accessJwt }) => updateSeenNotifications(accessJwt))

export const markTaskNotificationsRead = createServerFn({ method: 'POST' })
  .validator(credential)
  .handler(async ({ data: token }) => {
    await backend('/api/notifications/read', { method: 'POST', token })
  })
