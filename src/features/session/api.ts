import { createServerFn } from '@tanstack/react-start'

import { backend, backendData, isSessionAuthError, RequestError } from '~/lib/http'
import type { RiceSession, RiceUser } from '~/lib/models'
import { withAvatars } from '../social/api'
import { pdsPost } from '~/lib/pds'
import { isPdsSession, isRiceSession, isSessionUser } from './session-data'

export type AuthOptions = {
  semi_enabled: boolean
  verification_mode: 'live' | 'log'
  registration_channels: Array<'sms' | 'email'>
  handle_domain: string
}

export const getAuthOptions = createServerFn({ method: 'GET' }).handler(() =>
  backend<AuthOptions>('/auth/semi/options'),
)

export async function requestSemiSession(ticket: string): Promise<RiceSession> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(ticket)) throw new Error('登录凭证无效或已过期，请重新登录。')
  const handoff = await backend<{
    riceToken: string; service: string; did: string; handle: string; accessJwt: string; refreshJwt: string
  }>(`/auth/semi/session/${ticket}`, { cache: 'no-store' })
  if (!handoff.riceToken) throw new Error('登录信息不完整，请重新登录。')
  const session = {
    token: handoff.riceToken,
    user: await withAvatars(await backendData<RiceUser>('/api/users/me', { token: handoff.riceToken, cache: 'no-store' })),
    pds: {
      service: handoff.service, did: handoff.did, handle: handoff.handle,
      access_jwt: handoff.accessJwt, refresh_jwt: handoff.refreshJwt,
    },
  }
  if (!isRiceSession(session)) throw new Error('登录信息不完整，请重新登录。')
  return session
}

export const redeemSemiSession = createServerFn({ method: 'POST' })
  .validator((ticket: string) => ticket)
  .handler(({ data }) => requestSemiSession(data))

export async function requestPdsSessionRefresh(pds: RiceSession['pds']) {
  let body: { accessJwt: string; refreshJwt: string; did: string; handle: string }
  try {
    body = await pdsPost<typeof body>('com.atproto.server.refreshSession', pds.refresh_jwt)
  } catch (error) {
    if (isSessionAuthError(error)) return null
    throw error
  }
  const refreshed = {
    service: pds.service, did: body.did, handle: body.handle, access_jwt: body.accessJwt, refresh_jwt: body.refreshJwt,
  }
  if (!isPdsSession(refreshed) || refreshed.did !== pds.did) throw new Error('登录状态刷新失败，请重新登录。')
  return refreshed
}

export const loginRice = createServerFn({ method: 'POST' })
  .validator((data: { identifier: string; password: string }) => data)
  .handler(async ({ data }) => {
    const session = await backendData<RiceSession>('/api/session', {
      method: 'POST', json: { identifier: data.identifier.trim().toLowerCase(), password: data.password },
    })
    if (!isRiceSession(session)) throw new Error('登录信息返回异常，请稍后重试。')
    return session
  })

export const logoutRice = createServerFn({ method: 'POST' })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    await backend('/api/session', { method: 'DELETE', token })
    return true
  })

export async function requestCurrentUser(token: string): Promise<RiceUser | null> {
  try {
    const user = await withAvatars(await backendData<RiceUser>('/api/users/me', { token }))
    if (!isSessionUser(user)) throw new Error('用户资料返回异常，请稍后重试。')
    return user
  } catch (error) {
    // Only an explicit rejection clears login; network errors and timeouts preserve it.
    if (error instanceof RequestError && error.status === 401) return null
    throw error
  }
}

export const getCurrentUser = createServerFn({ method: 'POST' })
  .validator((token: string) => token)
  .handler(({ data: token }) => requestCurrentUser(token))

export const refreshPdsSession = createServerFn({ method: 'POST' })
  .validator((pds: RiceSession['pds']) => pds)
  .handler(({ data }) => requestPdsSessionRefresh(data))
