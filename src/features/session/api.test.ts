import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestCurrentUser, requestLogout, requestPdsSessionRefresh, requestSemiSession } from './api'

afterEach(() => vi.unstubAllGlobals())

it('only treats an explicit current-user 401 as an expired session', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ errors: { detail: '未认证' } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ errors: { detail: '服务暂不可用' } }, { status: 503 }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch')))
  await expect(requestCurrentUser('old-token')).resolves.toBeNull()
  await expect(requestCurrentUser('valid-token')).rejects.toThrow('服务暂不可用')
  await expect(requestCurrentUser('valid-token')).rejects.toThrow('网络连接失败')
})

describe('PDS session refresh', () => {
  it('uses the AT Protocol POST method with the refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessJwt: 'fresh-access',
          refreshJwt: 'rotated-refresh',
          did: 'did:example:mo',
          handle: 'mo.local',
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestPdsSessionRefresh({
      service: 'http://pds',
      did: 'did:example:mo',
      handle: 'mo.local',
      access_jwt: 'expired-access',
      refresh_jwt: 'one-use-refresh',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('com.atproto.server.refreshSession'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer one-use-refresh' },
      }),
    )
    expect(result?.refresh_jwt).toBe('rotated-refresh')
  })

  it('distinguishes a revoked refresh token from a temporary PDS failure', async () => {
    const pds = { service: 'http://pds', did: 'did:example:mo', handle: 'mo.local', access_jwt: 'old', refresh_jwt: 'revoked' }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'ExpiredToken' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ message: 'PDS unavailable' }, { status: 503 })))
    await expect(requestPdsSessionRefresh(pds)).resolves.toBeNull()
    await expect(requestPdsSessionRefresh(pds)).rejects.toThrow('PDS unavailable')
  })
})

describe('current-session logout', () => {
  it('revokes Rice and PDS separately, using the refresh token and accepting empty success bodies', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/session')) {
        expect(init.method).toBe('DELETE')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rice-token')
        return new Response(null, { status: 204 })
      }
      expect(new URL(url).pathname).toBe('/pds/xrpc/com.atproto.server.deleteSession')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer refresh-token')
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(requestLogout({ token: 'rice-token', refreshJwt: 'refresh-token' })).resolves.toEqual({ riceRevoked: true, pdsRevoked: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['Rice', 'PDS'])('still attempts the other service when %s fails, exposing partial failure', async failed => {
    const fetch = vi.fn(async (url: string) => {
      const rice = url.endsWith('/api/session')
      if ((failed === 'Rice') === rice) return Response.json({ error: 'Unavailable' }, { status: 503 })
      return rice ? new Response(null, { status: 204 }) : new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(requestLogout({ token: 'rice-token', refreshJwt: 'refresh-token' })).resolves.toEqual({ riceRevoked: failed !== 'Rice', pdsRevoked: failed !== 'PDS' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('treats already-invalid sessions as revoked without hiding upstream errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ error: 'InvalidToken' }, { status: 401 }))))
    await expect(requestLogout({ token: 'rice-token', refreshJwt: 'refresh-token' })).resolves.toEqual({ riceRevoked: true, pdsRevoked: true })
  })
})

describe('Semi handoff', () => {
  const ticket = 'a'.repeat(32)
  const handoff = { riceToken: 'rice-token', service: 'https://app.example/pds', did: 'did:plc:alice', handle: 'alice.test', accessJwt: 'pds-access', refreshJwt: 'pds-refresh' }
  it('uses the Rice token for the profile and retains distinct PDS tokens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(handoff))
      .mockResolvedValueOnce(Response.json({ data: { id: 'user-1', did: handoff.did, handle: handoff.handle } }))
    vi.stubGlobal('fetch', fetchMock)
    const session = await requestSemiSession(ticket)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer rice-token')
    expect(session.token).toBe('rice-token')
    expect(session.pds.access_jwt).toBe('pds-access')
  })
  it('rejects a different Rice identity and invalid tickets instead of pretending login succeeded', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(handoff))
      .mockResolvedValueOnce(Response.json({ data: { id: 'user-2', did: 'did:plc:other', handle: 'other.test' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestSemiSession(ticket)).rejects.toThrow('登录信息不完整')
    await expect(requestSemiSession('../wrong')).rejects.toThrow('登录凭证无效')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
