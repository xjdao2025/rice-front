import { afterEach, expect, it, vi } from 'vitest'
import { requestVerificationCode } from '~/features/account/api'
import { loadGovernanceBody } from '~/features/alliance/api'
import { updateSeenNotifications } from '~/features/notifications/api'
import { isSessionAuthError } from './http'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const requests: Array<[string, () => Promise<unknown>, 'json' | 'text']> = [
  ['verification', () => requestVerificationCode({ channel: 'sms', phone: '13800000000', purpose: 'register' }), 'json'],
  ['governance body', () => loadGovernanceBody({ id: 'attachment-1' }), 'text'],
  ['notification seen', () => updateSeenNotifications('access-token'), 'json'],
]

it.each(requests.flatMap(([name, start, body]) => (['connection', 'body'] as const).map(phase => [`${name}/${phase}`, start, body, phase] as const)))(
  '%s has a deadline and does not claim authentication failure',
  async (_name, start, body, phase) => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const reading = Promise.withResolvers<void>()
    vi.stubGlobal('fetch', vi.fn((_input, init: RequestInit) => {
      const pending = () => new Promise<never>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      })
      if (phase === 'connection') return pending()
      // updateSeen normally has no body; a failing upstream still must bound its error body.
      const response = new Response('{}', { status: body === 'text' ? 200 : 503 })
      vi.spyOn(response, body).mockImplementation(() => { reading.resolve(); return pending() })
      return Promise.resolve(response)
    }))
    const result = start().catch((error: unknown) => error)
    if (phase === 'body') await reading.promise
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))
    const error = await result
    expect((error as Error).message).toBe('请求超时，请稍后重试。')
    expect(isSessionAuthError(error)).toBe(false)
    expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000)
  },
)
