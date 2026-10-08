import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  verify: vi.fn(), register: vi.fn(), save: vi.fn(), navigate: vi.fn(),
  upload: vi.fn(), update: vi.fn(), session: null as unknown,
  channels: ['sms', 'email'] as Array<'sms' | 'email'>,
  values: [] as unknown[], index: 0,
}))
vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(), verifyRegistration: mock.verify, registerRice: mock.register,
  uploadRiceAttachment: mock.upload, updateCurrentUser: mock.update,
}))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ saveSession: mock.save, session: mock.session, isReady: true }) }))
vi.mock('~/lib/images', async (original) => ({ ...await original<typeof import('~/lib/images')>(), readFileBase64: async () => 'image-bytes' }))
vi.mock('../session/useAuthOptions', () => ({ useAuthOptions: () => ({
  options: { registration_channels: mock.channels, handle_domain: 'configured.example', verification_mode: 'live' },
}) }))
vi.mock('@tanstack/react-router', () => ({ Link: () => null, useNavigate: () => mock.navigate }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mock.index++
    if (!(index in mock.values)) mock.values[index] = initial
    return [mock.values[index], (value: unknown) => { mock.values[index] = value }]
  },
  useEffect: () => undefined,
}))

import { RegisterPage } from './RegisterPage'
import { ProfileEditPage } from './ProfileEditPage'
import { requestRegistration } from './api'

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function render() {
  mock.index = 0
  return elements(RegisterPage({ returnTo: '/tasks' }))
}
const field = (label: string) => render().find((node) => node.props.label === label)!.props
const next = () => field('下一步').clickAction as () => Promise<void>
const session = {
  token: 'rice-token', user: { id: 'user-1', did: 'did:plc:user', handle: 'alice.configured.example' },
  pds: { did: 'did:plc:user', handle: 'alice.configured.example', service: 'https://pds.example', access_jwt: 'pds-token', refresh_jwt: 'pds-refresh' },
}
afterEach(() => { mock.values = []; mock.session = null; mock.channels = ['sms', 'email']; vi.clearAllMocks(); vi.unstubAllGlobals() })

it('verifies credentials first, previews the configured username, and saves the account before avatar setup', async () => {
  const verification = render().find((node) => node.props.purpose === 'register')!.props
  ;(verification.setContact as (value: string) => void)('13800000000')
  ;(verification.setCode as (value: string) => void)('123456')
  ;(field('密码').onChange as (value: string) => void)('password123')
  mock.verify.mockRejectedValueOnce(new Error('验证码不正确')).mockResolvedValueOnce({ ticket: 'verified-ticket' })
  await next()()
  expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('验证码不正确')
  expect(mock.register).not.toHaveBeenCalled()
  await next()()
  expect(mock.verify).toHaveBeenLastCalledWith({ data: { channel: 'sms', phone: '13800000000', phoneRegion: '86', code: '123456' } })
  expect(field('下一步').isDisabled).toBe(true)
  ;(field('用户名').onChange as (value: string) => void)('Alice-01')
  expect(render().find((node) => node.props['aria-live'] === 'polite')?.props.children).toEqual(['@', 'alice-01', '.', 'configured.example'])
  mock.register.mockRejectedValueOnce(new Error('用户名已被使用')).mockResolvedValueOnce(session)
  mock.save.mockImplementationOnce((session) => { mock.session = session })
  await next()()
  expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('用户名已被使用')
  expect(mock.save).not.toHaveBeenCalled()
  await next()()
  expect(mock.register).toHaveBeenLastCalledWith({ data: { ticket: 'verified-ticket', username: 'Alice-01', password: 'password123' } })
  expect(mock.save).toHaveBeenCalledWith(session)
  expect(mock.navigate).not.toHaveBeenCalled()
  mock.values = [] // AppShell remounts its children when the account changes.
  const avatar = render().find((node) => node.type === ProfileEditPage)!
  expect(avatar.props.avatarOnly).toBe(true)
  await (avatar.props.onSaved as () => Promise<void>)()
  expect(mock.navigate).toHaveBeenCalledWith({ href: '/tasks', replace: true })
})

it('registers with email when the backend offers it and clears the previous phone code on channel change', async () => {
  const fields = () => render().find((node) => node.props.purpose === 'register')!.props
  ;(fields().setContact as (value: string) => void)('13800000000')
  ;(fields().setCode as (value: string) => void)('123456')
  ;(fields().setChannel as (value: string) => void)('email')
  expect(fields().channel).toBe('email')
  expect(fields().contact).toBe('')
  expect(fields().code).toBe('')
  ;(fields().setContact as (value: string) => void)(' Alice@Example.COM ')
  ;(fields().setCode as (value: string) => void)('654321')
  ;(field('密码').onChange as (value: string) => void)('password123')
  mock.verify.mockResolvedValueOnce({ ticket: 'email-ticket' })
  await next()()
  expect(mock.verify).toHaveBeenCalledWith({ data: { channel: 'email', email: ' Alice@Example.COM ', code: '654321' } })
  expect(field('用户名')).toBeTruthy()
})

it('shows email immediately when it is the only backend-enabled registration channel', () => {
  mock.channels = ['email']
  const verification = render().find((node) => node.props.purpose === 'register')!.props
  expect(verification.channel).toBe('email')
  expect(verification.channels).toEqual(['email'])
})

it('rejects invalid username prefixes before transport and sends only the normalized prefix with verified credentials', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: session }))
  vi.stubGlobal('fetch', fetch)
  for (const username of ['', 'ab', '-abc', 'abc-', 'a.b', 'a_b', '用户名', 'a'.repeat(19)]) {
    await expect(requestRegistration({ ticket: 'ticket', username, password: 'password123' })).rejects.toThrow('用户名须为')
  }
  expect(fetch).not.toHaveBeenCalled()
  await expect(requestRegistration({ ticket: 'ticket', username: ' Alice-01 ', password: 'password123' })).resolves.toEqual(session)
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ticket: 'ticket', username: 'alice-01', password: 'password123' })
  fetch.mockResolvedValueOnce(Response.json({ errors: { detail: '用户名已被使用' } }, { status: 422 }))
  await expect(requestRegistration({ ticket: 'ticket', username: 'alice', password: 'password123' })).rejects.toThrow('用户名已被使用')
  fetch.mockResolvedValueOnce(Response.json({ data: { token: 'incomplete' } }))
  await expect(requestRegistration({ ticket: 'ticket', username: 'alice', password: 'password123' })).rejects.toThrow('登录信息返回异常')
})

it('uploads onboarding avatars with Rice auth, keeps the created account on failure, and allows finishing without upload', async () => {
  mock.session = { ...session, user: { ...session.user, nickname: 'Alice', bio: '简介' } }
  const finish = vi.fn()
  const avatarView = () => {
    mock.index = 0
    return elements(ProfileEditPage({ avatarOnly: true, onSaved: finish }))
  }
  const props = (label: string) => avatarView().find((node) => node.props.label === label)!.props
  const complete = () => (props('完成').clickAction as () => Promise<void>)()
  expect(avatarView().some((node) => node.props.label === '昵称' || node.props.label === '简介')).toBe(false)
  await complete()
  expect(finish).toHaveBeenCalledTimes(1)
  expect(mock.upload).not.toHaveBeenCalled()
  finish.mockClear()
  ;(props('头像').onChange as (file: File) => void)(new File(['avatar'], 'avatar.png', { type: 'image/png' }))
  mock.upload.mockRejectedValueOnce(new Error('上传失败')).mockResolvedValueOnce({ id: 'avatar-1' })
  await complete()
  expect(avatarView().find((node) => node.props.role === 'alert')?.props.children).toBe('上传失败')
  expect(mock.save).not.toHaveBeenCalled()
  expect(finish).not.toHaveBeenCalled()
  mock.update.mockResolvedValueOnce({ ...session.user, avatar: { id: 'avatar-1' } })
  await complete()
  expect(mock.upload).toHaveBeenLastCalledWith({ data: { token: 'rice-token', filename: 'avatar.png', contentType: 'image/png', base64: 'image-bytes' } })
  expect(mock.update).toHaveBeenLastCalledWith({ data: { token: 'rice-token', nickname: 'Alice', bio: '简介', avatarId: 'avatar-1' } })
  expect(mock.save).toHaveBeenCalledWith({ ...session, user: { ...session.user, avatar: { id: 'avatar-1' } } })
  expect(finish).toHaveBeenCalledTimes(1)
})
