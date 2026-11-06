import { afterEach, expect, it, vi } from 'vitest'

// Supply only the Server Function builder so real schemas can be exercised
// without a Start request context. Invalid inputs must never enter a handler.
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({
  handler: (run: () => unknown) => run,
  validator: (validate: (data: unknown) => unknown) => ({
    handler: (run: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) => run({ data: validate(input.data) }),
  }),
}) }))
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => ({ headers: new Headers() }) }))
import { requestRiceAttachment, sendVerificationCode, updateCurrentUser, uploadRiceAttachment } from '~/features/account/api'
import { createReply, createTextPost, getPosts } from '~/features/feed/api'
import { createTask, taskDraftBody, taskDraftInput } from '~/features/tasks/api'
import { eventAction } from '~/features/events/api'
import { sendPersonalGrains } from '~/features/grains/api'
import { voteOnProposal } from '~/features/alliance/api'
import { getNotifications } from '~/features/notifications/api'
import { loginRice, logoutRice } from '~/features/session/api'
import { MAX_IMAGE_BYTES } from './images'
import { array, integer, object, optional, text } from './validation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const invalidInputs: Array<[string, unknown, unknown]> = [
  ['contact object', sendVerificationCode, { channel: 'sms', phone: {}, purpose: 'register' }],
  ['profile object', updateCurrentUser, { token: 't', nickname: {}, bio: '' }],
  ['login identifier', loginRice, { identifier: {}, password: 'password' }],
  ['old logout shape', logoutRice, 'token'],
  ['feed query', getPosts, { query: [] }],
  ['reply strong ref', createReply, { did: 'did:test', accessJwt: 'p', token: 'r', text: 'reply', root: null, parent: {} }],
  ['post image structure', createTextPost, { did: 'did:test', accessJwt: 'p', token: 'r', text: '', category: 'post', rkey: 'k', createdAt: 'now', images: [{}] }],
  ['null reward', createTask, { token: 't', title: 'T', description: 'D', capacity: 1, rewardAmount: null, status: 'draft' }],
  ['recipient object', sendPersonalGrains, { token: 't', to: {}, amount: 1, clientRequestId: 'key' }],
  ['action enum', eventAction, { token: 't', id: 'event', action: '../publish' }],
  ['vote enum', voteOnProposal, { token: 't', id: 'proposal', choice: 'admin' }],
  ['notification token', getNotifications, { token: {} }],
  ['upload MIME', uploadRiceAttachment, { token: 't', filename: 'x.html', contentType: 'text/html', base64: 'YQ==' }],
]

it.each(invalidInputs)('rejects %s before transport or string operations', async (_label, fn, data) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect((fn as (input: { data: unknown }) => Promise<unknown>)({ data })).rejects.toThrow('请求参数无效')
  expect(fetch).not.toHaveBeenCalled()
})

it('accepts a personal draft’s existing empty node selection and strips unrecognized fields', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: { id: 'draft' } }))
  vi.stubGlobal('fetch', fetch)
  const parsed = taskDraftInput({ token: 't', title: 'T', description: 'D', capacity: 1, rewardAmount: 0, status: 'draft', nodeId: '', fundingSource: 'personal', admin: true })
  expect(taskDraftBody(parsed).node_id).toBeUndefined()
  expect(taskDraftBody(parsed).funding_source).toBe('personal')
  expect(parsed).not.toHaveProperty('admin')
  expect(fetch).not.toHaveBeenCalled()
  expect(object({ value: text(5), next: optional(integer(1, 10)) })({ value: 'ok', admin: true })).toEqual({ value: 'ok', next: undefined })
})

it('bounds attachment encoded and decoded size before Buffer allocation', () => {
  vi.stubGlobal('fetch', vi.fn())
  const allocate = vi.spyOn(Buffer, 'from')
  const base = { token: 't', filename: 'photo.png', contentType: 'image/png' }
  expect(() => requestRiceAttachment({ ...base, base64: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) })).toThrow('请求参数无效')
  expect(() => requestRiceAttachment({ ...base, base64: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4) })).toThrow('超过 5 MB')
  expect(() => requestRiceAttachment({ ...base, base64: 'not base64!' })).toThrow('图片无效')
  expect(allocate).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects oversized arrays, non-finite or fractional amounts, and non-object roots', () => {
  expect(() => array(text(4), 2)(['a', 'b', 'c'])).toThrow()
  for (const value of [null, {}, '1', NaN, Infinity, 1.1, -1]) expect(() => integer(0, 10)(value)).toThrow()
  for (const value of [null, [], 'text']) expect(() => object({ x: text() })(value)).toThrow()
})
