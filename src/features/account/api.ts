import { createServerFn } from '@tanstack/react-start'

import { BACKEND_BASE, backend, backendData, readJson } from '~/lib/http'
import type { RiceAttachment, RiceSession, RiceUser } from '~/lib/models'
import { withAvatars } from '../social/api'
import { isRiceSession } from '../session/session-data'

export type VerificationChannel = 'sms' | 'email'
export type VerificationPurpose = 'register' | 'reset_password' | 'modify_phone' | 'modify_email' | 'delete_account'

type ContactInput = { channel: VerificationChannel; phone?: string; phoneRegion?: string; email?: string }

const contactBody = (data: ContactInput) => data.channel === 'sms'
  ? { phone: data.phone?.trim(), phone_region: data.phoneRegion || '86' }
  : { email: data.email?.trim().toLowerCase() }

export const sendVerificationCode = createServerFn({ method: 'POST' })
  .validator((data: ContactInput & { purpose: VerificationPurpose }) => data)
  .handler(({ data }) => requestVerificationCode(data))

export async function requestVerificationCode(data: ContactInput & { purpose: VerificationPurpose }) {
  let response: Response
  try {
    response = await fetch(`${BACKEND_BASE}/api/verification_codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: data.channel, ...contactBody(data), purpose: data.purpose }),
    })
  } catch {
    throw new Error('网络连接失败，请检查网络后重试。')
  }
  const retryAfter = Number(response.headers.get('Retry-After') ?? 60)
  if (response.status === 429) return { sent: false, retryAfter }
  await readJson(response)
  return { sent: true, retryAfter }
}

export const verifyRegistration = createServerFn({ method: 'POST' })
  .validator((data: ContactInput & { code: string }) => data)
  .handler(async ({ data }) => backendData<{ ticket: string; expires_in: number }>('/api/registrations/verification', {
    method: 'POST', json: { channel: data.channel, ...contactBody(data), code: data.code.trim() },
  }))

type RegistrationInput = { ticket: string; username: string; password: string }

export function registrationUsernameError(username: unknown) {
  if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9-]{1,16}[a-z0-9]$/i.test(username.trim())) {
    return '用户名须为 3–18 个字母、数字或连字符，不能以连字符开头或结尾。'
  }
  return ''
}

export async function requestRegistration(data: RegistrationInput) {
  const error = registrationUsernameError(data.username)
  if (error) throw new Error(error)
  const session = await backendData<RiceSession>('/api/registrations', {
    method: 'POST',
    json: { ticket: data.ticket, username: data.username.trim().toLowerCase(), password: data.password },
  })
  if (!isRiceSession(session)) throw new Error('登录信息返回异常，请稍后重试。')
  return session
}

export const registerRice = createServerFn({ method: 'POST' })
  .validator((data: RegistrationInput) => data)
  .handler(({ data }) => requestRegistration(data))

export const resetRicePassword = createServerFn({ method: 'POST' })
  .validator((data: ContactInput & { code: string; password: string }) => data)
  .handler(async ({ data }) => {
    await backend('/api/passwords/reset', {
      method: 'POST',
      json: { channel: data.channel, ...contactBody(data), code: data.code.trim(), password: data.password },
    })
    return true
  })

export const updateCurrentUser = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nickname: string; bio: string; avatarId?: string }) => data)
  .handler(async ({ data }) => withAvatars(await backendData<RiceUser>('/api/users/me', {
    method: 'PATCH',
    token: data.token,
    json: { nickname: data.nickname, bio: data.bio, ...(data.avatarId ? { avatar_id: data.avatarId } : {}) },
  })))

export const uploadRiceAttachment = createServerFn({ method: 'POST' })
  .validator((data: { token: string; filename: string; contentType: string; base64: string }) => data)
  .handler(({ data }) => {
    const form = new FormData()
    form.append('kind', 'image')
    form.append('file', new Blob([Buffer.from(data.base64, 'base64')], { type: data.contentType }), data.filename)
    return backendData<RiceAttachment>('/api/attachments', { method: 'POST', token: data.token, body: form })
  })

export const changeCurrentUserContact = createServerFn({ method: 'POST' })
  .validator((data: ContactInput & { token: string; code: string }) => data)
  .handler(async ({ data }) => backendData<RiceUser>(`/api/users/me/${data.channel === 'sms' ? 'phone' : 'email'}`, {
    method: 'PUT', token: data.token, json: { ...contactBody(data), code: data.code.trim() },
  }))

export const deleteCurrentUser = createServerFn({ method: 'POST' })
  .validator((data: { token: string; channel: VerificationChannel; code: string }) => data)
  .handler(async ({ data }) => {
    await backend('/api/users/me', {
      method: 'DELETE', token: data.token, json: { channel: data.channel, code: data.code.trim() },
    })
    return true
  })
