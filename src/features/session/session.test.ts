import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RiceSession } from '~/lib/models'

import {
  readStoredSession,
  refreshStoredSession,
  refreshStoredUser,
  tokenExpiresSoon,
  watchPdsSessionLifetime,
  writeStoredSession,
} from './session'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function useMemoryStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    dispatchEvent: vi.fn(),
  })
}

const storedSession = {
  token: 'rice-token',
  user: { id: 'mo', did: 'did:example:mo', handle: 'mo.local', nickname: '旧名字' },
  pds: {
    service: 'http://pds',
    did: 'did:example:mo',
    handle: 'mo.local',
    access_jwt: 'expired-access',
    refresh_jwt: 'one-use-refresh',
  },
} as RiceSession

function jwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  return `header.${payload}.signature`
}

function useLifecycleStorage() {
  useMemoryStorage()
  const events = new EventTarget()
  Object.assign(window, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  })
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', page)
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 8, 27))
  const stored = { ...storedSession, pds: { ...storedSession.pds, access_jwt: jwt(Date.now() / 1000 + 120) } }
  writeStoredSession(stored)
  return { stored, page }
}

function renewCurrentSession(refresh: Parameters<typeof refreshStoredSession>[1]) {
  return async () => {
    const stored = readStoredSession()
    if (stored && tokenExpiresSoon(stored.pds.access_jwt)) await refreshStoredSession(stored, refresh)
  }
}

describe('PDS session lifetime', () => {
  it('refreshes only tokens that are expired or about to expire', () => {
    const now = Date.UTC(2026, 8, 1)
    expect(tokenExpiresSoon(jwt(now / 1000 + 30), now)).toBe(true)
    expect(tokenExpiresSoon(jwt(now / 1000 + 120), now)).toBe(false)
  })

  it('deduplicates concurrent refreshes that use one rotating refresh token', async () => {
    const stored = storedSession
    const refreshedPds = {
      ...stored.pds,
      access_jwt: 'fresh-access',
      refresh_jwt: 'rotated-refresh',
    }
    const refresh = vi.fn(async () => refreshedPds)

    const [first, second] = await Promise.all([
      refreshStoredSession(stored, refresh),
      refreshStoredSession(stored, refresh),
    ])

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(first?.pds).toEqual(refreshedPds)
    expect(second).toEqual(first)
  })

  it.each(['logout', 'another account', 'new login'])(
    'does not restore an old session when refresh finishes after %s',
    async (change) => {
      useMemoryStorage()
      writeStoredSession(storedSession)
      const next = change === 'logout' ? null : {
        ...storedSession,
        token: 'new-rice-token',
        user: { ...storedSession.user, did: change === 'another account' ? 'did:example:other' : storedSession.user.did },
        pds: {
          ...storedSession.pds,
          did: change === 'another account' ? 'did:example:other' : storedSession.pds.did,
        },
      }

      await refreshStoredSession(storedSession, async () => {
        writeStoredSession(next)
        return { ...storedSession.pds, access_jwt: 'refreshed-access' }
      })

      expect(readStoredSession()).toEqual(next)
    },
  )

  it('preserves profile changes made while the PDS token refresh was pending', async () => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    const updated = { ...storedSession, user: { ...storedSession.user, nickname: '新名字' } }
    const pds = { ...storedSession.pds, access_jwt: 'refreshed-access', refresh_jwt: 'rotated' }

    await refreshStoredSession(storedSession, async () => {
      writeStoredSession(updated)
      return pds
    })

    expect(readStoredSession()).toEqual({ ...updated, pds })
  })

  it('clears only the account whose PDS refresh token was revoked', async () => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    await expect(refreshStoredSession(storedSession, async () => null)).resolves.toBeNull()
    expect(readStoredSession()).toBeNull()

    writeStoredSession(storedSession)
    const newer = { ...storedSession, token: 'new-rice-token' }
    await refreshStoredSession(storedSession, async () => {
      writeStoredSession(newer)
      return null
    })
    expect(readStoredSession()).toEqual(newer)
  })

  it('renews a long-lived page before expiry and stops its timer and listeners on cleanup', async () => {
    const { stored } = useLifecycleStorage()
    const pds = { ...stored.pds, access_jwt: jwt(Date.now() / 1000 + 3600), refresh_jwt: 'rotated' }
    const refresh = vi.fn(async () => pds)
    const stop = watchPdsSessionLifetime(renewCurrentSession(refresh))
    await vi.advanceTimersByTimeAsync(59_999)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ data: stored.pds })
    expect(readStoredSession()).toEqual({ ...stored, pds })
    expect(vi.getTimerCount()).toBe(1)
    stop()
    writeStoredSession(stored)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(3600_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes an expired token on returning from a hidden page or browser history, once for concurrent events', async () => {
    const { stored, page } = useLifecycleStorage()
    const pds = { ...stored.pds, access_jwt: jwt(Date.now() / 1000 + 3600), refresh_jwt: 'rotated' }
    const refresh = vi.fn(async () => pds)
    const stop = watchPdsSessionLifetime(renewCurrentSession(refresh))
    page.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(120_000)
    expect(refresh).not.toHaveBeenCalled()
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pageshow'))
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(readStoredSession()).toEqual({ ...stored, pds })
    stop()
  })

  it('does not probe a healthy session on startup, return, or unrelated storage changes', async () => {
    const { stored, page } = useLifecycleStorage()
    const sync = vi.fn(async () => {})
    const stop = watchPdsSessionLifetime(sync)
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pageshow'))
    page.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'notification-state' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).not.toHaveBeenCalled()
    expect(readStoredSession()).toEqual(stored)
    page.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(120_000)
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'notification-state' }))
    expect(sync).not.toHaveBeenCalled()
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledTimes(1)
    stop()
  })

  it('preserves failed refreshes without retrying indefinitely, and does not refresh after logout', async () => {
    const { stored } = useLifecycleStorage()
    const failure = new Error('PDS unavailable')
    const refresh = vi.fn().mockRejectedValue(failure)
    const errors: unknown[] = []
    const stop = watchPdsSessionLifetime(async () => {
      try { await renewCurrentSession(refresh)() } catch (error) { errors.push(error) }
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errors).toEqual([failure])
    expect(readStoredSession()).toEqual(stored)
    await vi.advanceTimersByTimeAsync(3600_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    writeStoredSession(null)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    stop()
  })

  it('arms the lifetime timer after the initial incomplete cache is repaired', async () => {
    const { stored } = useLifecycleStorage()
    const { user, ...credentials } = stored
    window.localStorage.setItem('xiangjian-rice-session', JSON.stringify(credentials))
    const refresh = vi.fn(async () => ({ ...stored.pds, access_jwt: jwt(Date.now() / 1000 + 3600) }))
    const loadUser = vi.fn(async () => user)
    const stop = watchPdsSessionLifetime(renewCurrentSession(refresh))
    await refreshStoredUser(credentials, loadUser)
    await vi.advanceTimersByTimeAsync(0)
    expect(loadUser).toHaveBeenCalledTimes(1)
    expect(readStoredSession()).toEqual(stored)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(readStoredSession()?.token).toBe(stored.token)
    stop()
  })
})

describe('stored session boundaries', () => {
  it.each([null, {}, [], { ...storedSession, user: undefined }, { ...storedSession, pds: undefined }, { ...storedSession, user: { id: 'mo' } }])(
    'never exposes incomplete cached data as a logged-in session: %j',
    (value) => {
      useMemoryStorage()
      window.localStorage.setItem('xiangjian-rice-session', JSON.stringify(value))
      expect(readStoredSession()).toBeNull()
    },
  )

  it('repairs the observed token+pds cache from the current user endpoint', async () => {
    useMemoryStorage()
    const { user, ...credentials } = storedSession
    window.localStorage.setItem('xiangjian-rice-session', JSON.stringify(credentials))
    expect(readStoredSession()).toBeNull()
    const loadUser = vi.fn().mockResolvedValue(user)
    await expect(refreshStoredUser(credentials, loadUser)).resolves.toEqual(storedSession)
    expect(loadUser).toHaveBeenCalledWith({ data: credentials.token })
    expect(readStoredSession()).toEqual(storedSession)
  })

  it.each([undefined, {}, { ...storedSession.user, did: 'did:example:other' }])(
    'preserves the last valid session when profile loading returns invalid data: %j',
    async (user) => {
      useMemoryStorage()
      writeStoredSession(storedSession)
      await expect(refreshStoredUser(storedSession, vi.fn().mockResolvedValue(user))).rejects.toThrow('用户资料返回异常')
      expect(readStoredSession()).toEqual(storedSession)
    },
  )

  it('clears expired credentials but preserves network failures and a newer login', async () => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    await expect(refreshStoredUser(storedSession, async () => null)).resolves.toBeNull()
    expect(readStoredSession()).toBeNull()

    writeStoredSession(storedSession)
    await expect(refreshStoredUser(storedSession, async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
    expect(readStoredSession()).toEqual(storedSession)
    await refreshStoredUser(storedSession, async () => null, () => false)
    expect(readStoredSession()).toEqual(storedSession)

    const newer = { ...storedSession, token: 'new-login-token' }
    await refreshStoredUser(storedSession, async () => {
      writeStoredSession(newer)
      return null
    })
    expect(readStoredSession()).toEqual(newer)
  })

  it('does not overwrite a valid cache with an invalid login result', () => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    expect(() => writeStoredSession({ ...storedSession, user: undefined } as unknown as RiceSession)).toThrow('登录信息不完整')
    expect(readStoredSession()).toEqual(storedSession)
  })

  it.each(['logout', 'new login'])('does not restore a pending profile response after %s', async (change) => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    const next = change === 'logout' ? null : { ...storedSession, token: 'new-login-token' }
    const result = await refreshStoredUser(storedSession, async () => {
      writeStoredSession(next)
      return storedSession.user
    })
    expect(result).toEqual(next)
    expect(readStoredSession()).toEqual(next)
  })

  it('rejects an invalid PDS refresh without damaging the previous session', async () => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    await expect(refreshStoredSession(storedSession, vi.fn().mockResolvedValue(undefined))).rejects.toThrow('登录状态刷新失败')
    expect(readStoredSession()).toEqual(storedSession)
  })

  it('does not overwrite an edited profile with an older same-account response', async () => {
    useMemoryStorage()
    writeStoredSession(storedSession)
    let revision = 0
    const requestRevision = revision
    const edited = { ...storedSession, user: { ...storedSession.user, nickname: '新昵称' } }
    const result = await refreshStoredUser(storedSession, async () => {
      writeStoredSession(edited)
      revision++
      return storedSession.user
    }, () => revision === requestRevision)
    expect(result).toEqual(edited)
    expect(readStoredSession()).toEqual(edited)
  })
})
