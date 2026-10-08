import { afterEach, describe, expect, it, vi } from 'vitest'
import { needsPageReload, PageReloadRequiredError, serverFunctionFetch } from './server-function-fetch'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('server function transport', () => {
  it('rejects the missing-function HTTP envelope without replaying a POST', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ message: 'Internal Server Error', status: 500, unhandled: true }, { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    const request = { method: 'POST', body: '{}' }
    await expect(serverFunctionFetch('/_serverFn/old-id', request)).rejects.toBeInstanceOf(PageReloadRequiredError)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/_serverFn/old-id', { ...request, signal: expect.any(AbortSignal) })
  })

  it.each(['x-tss-serialized', 'x-tss-raw'])('leaves %s responses and business errors for Start to decode', async (header) => {
    const response = Response.json({ error: 'business error' }, { status: 500, headers: { [header]: 'true' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    expect(await serverFunctionFetch('/_serverFn/current')).toBe(response)
    expect(response.bodyUsed).toBe(false)
  })

  it.each([{ result: null }, { isSerializedRedirect: true, href: '/login' }, { isNotFound: true }])('preserves supported plain JSON envelopes', async (body) => {
    const response = Response.json(body)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    expect(await serverFunctionFetch('/_serverFn/current')).toBe(response)
    expect(await response.json()).toEqual(body)
  })

  it.each([
    () => Response.json({ unexpected: true }),
    () => new Response('<html>outdated route</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => new Response('Not Found', { status: 404 }),
  ])('does not treat an invalid result as a successful undefined value', async (createResponse) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse()))
    await expect(serverFunctionFetch('/_serverFn/current')).rejects.toBeInstanceOf(PageReloadRequiredError)
  })

  it('reports a service outage without exposing response contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'internal details' }, { status: 502 })))
    await expect(serverFunctionFetch('/_serverFn/current')).rejects.toThrow('服务暂时不可用，请稍后重试。')
  })

  it('localizes network failure and preserves cancellation', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const aborted = new DOMException('Aborted', 'AbortError')
    fetch.mockRejectedValueOnce(aborted)
    vi.stubGlobal('fetch', fetch)
    await expect(serverFunctionFetch('/_serverFn/current')).rejects.toThrow('网络连接失败，请检查网络后重试。')
    await expect(serverFunctionFetch('/_serverFn/current')).rejects.toBe(aborted)
  })

  it('ends a stalled connection as a timeout without retrying the operation', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const fetch = vi.fn((_input, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const request = serverFunctionFetch('/_serverFn/current', { method: 'POST' })
    timeout.abort(new DOMException('Connection timed out', 'TimeoutError'))
    await expect(request).rejects.toThrow('请求超时，请稍后重试。')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

it('offers reload for stale JS chunks or RPC versions, not ordinary business errors', () => {
  expect(needsPageReload(new PageReloadRequiredError())).toBe(true)
  expect(needsPageReload(new TypeError('Failed to fetch dynamically imported module: /assets/old.js'))).toBe(true)
  expect(needsPageReload(new TypeError('Importing a module script failed.'))).toBe(true)
  expect(needsPageReload(new Error('账号或密码错误'))).toBe(false)
  expect(needsPageReload(new TypeError('Failed to fetch'))).toBe(false)
})
