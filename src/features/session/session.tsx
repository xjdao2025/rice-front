import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import type { RiceSession, RiceUser } from '~/lib/models'

import { getCurrentUser, logoutRice, refreshPdsSession } from './api'
import { hasSessionCredentials, isPdsSession, isRiceSession, isSessionUser, type SessionCredentials } from './session-data'

const STORAGE_KEY = 'xiangjian-rice-session'
const CHANGE_EVENT = 'xiangjian-session-change'
const PDS_REFRESH_MARGIN_MS = 60_000
const pendingRefreshes = new Map<string, Promise<RiceSession | null>>()
type PdsRefresh = (input: { data: RiceSession['pds'] }) => Promise<RiceSession['pds'] | null>

type SessionState = {
  session: RiceSession | null
  isReady: boolean
  recoveryError: string
  saveSession: (session: RiceSession | null) => void
}

const SessionContext = createContext<SessionState | null>(null)

/** Adds a listener and returns its removal. */
function listen<E extends Event>(target: EventTarget, type: string, listener: (event: E) => void) {
  target.addEventListener(type, listener as EventListener)
  return () => target.removeEventListener(type, listener as EventListener)
}

function readStoredValue(): unknown {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

export function readStoredSession(): RiceSession | null {
  const value = readStoredValue()
  return isRiceSession(value) ? value : null
}

function readStoredCredentials(): SessionCredentials | null {
  const value = readStoredValue()
  return hasSessionCredentials(value) ? value : null
}

export function writeStoredSession(session: RiceSession | null) {
  if (session !== null && !isRiceSession(session)) throw new Error('登录信息不完整，请重新登录。')
  if (typeof window === 'undefined') return

  if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  else window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// A profile response is not allowed to restore a stale refresh token or login.
export function writeStoredUser(stored: RiceSession, user: RiceUser) {
  const latest = readStoredSession()
  if (!latest || latest.token !== stored.token || latest.pds.did !== stored.pds.did) return latest
  if (!isSessionUser(user) || user.did !== latest.pds.did) throw new Error('用户资料返回异常，请稍后重试。')
  const updated = { ...latest, user }
  writeStoredSession(updated)
  return updated
}

// Repair an incomplete cache using its existing credentials, never a different account's profile.
export async function refreshStoredUser(
  stored: SessionCredentials,
  loadUser: (input: { data: string }) => Promise<RiceUser | null> = getCurrentUser,
  isCurrent: () => boolean = () => true,
) {
  const user = await loadUser({ data: stored.token })
  const latest = readStoredCredentials()
  if (!isCurrent() || latest?.token !== stored.token || latest.pds.did !== stored.pds.did) return readStoredSession()
  if (user === null) { writeStoredSession(null); return null }
  if (!isSessionUser(user) || user.did !== stored.pds.did) throw new Error('用户资料返回异常，请稍后重试。')
  const updated = { ...latest, user }
  writeStoredSession(updated)
  return updated
}

function tokenExpiresAt(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(normalized)) as { exp?: number }
    return typeof exp === 'number' && Number.isFinite(exp * 1000) ? exp * 1000 : null
  } catch {
    return null
  }
}

export function tokenExpiresSoon(token: string, now = Date.now(), thresholdMs = PDS_REFRESH_MARGIN_MS) {
  const expiresAt = tokenExpiresAt(token)
  return expiresAt !== null && expiresAt <= now + thresholdMs
}

export function watchPdsSessionLifetime(sync: () => Promise<void>) {
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let failedAttempts = 0
  const schedule = () => {
    clearTimeout(timer)
    if (!active) return
    const stored = readStoredSession()
    const expiresAt = stored && tokenExpiresAt(stored.pds.access_jwt)
    if (expiresAt && expiresAt > Date.now() + PDS_REFRESH_MARGIN_MS) {
      failedAttempts = 0
      timer = setTimeout(check, Math.min(expiresAt - Date.now() - PDS_REFRESH_MARGIN_MS, 2_147_483_647))
    } else if (stored && expiresAt && failedAttempts > 0 && failedAttempts < 3) {
      timer = setTimeout(check, 15_000 * 2 ** (failedAttempts - 1))
    }
  }
  const runSync = () => {
    if (pending) return
    const before = readStoredSession()?.pds.access_jwt
    pending = sync().catch(() => undefined).finally(() => {
      const after = readStoredSession()
      failedAttempts = after?.pds.access_jwt === before && tokenExpiresSoon(before ?? '') ? failedAttempts + 1 : 0
      pending = undefined
      schedule()
    })
  }
  const check = () => {
    if (!active || document.visibilityState === 'hidden') return
    const stored = readStoredSession()
    if (stored && tokenExpiresSoon(stored.pds.access_jwt)) runSync()
    else schedule()
  }
  const storageChanged = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) check()
  }
  const stops = [
    listen(window, CHANGE_EVENT, check),
    listen(window, 'storage', storageChanged),
    listen(window, 'pageshow', check),
    listen(document, 'visibilitychange', check),
  ]
  check()
  return () => {
    active = false
    clearTimeout(timer)
    stops.forEach((stop) => stop())
  }
}

export function refreshStoredSession(stored: RiceSession, refresh: PdsRefresh = refreshPdsSession) {
  if (!isRiceSession(stored)) return Promise.reject(new Error('登录信息不完整，请重新登录。'))
  const key = stored.pds.refresh_jwt
  const pending = pendingRefreshes.get(key)
  if (pending) return pending

  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  const run = async () => {
    // A different tab may have rotated the refresh token while we waited.
    const current = readStoredSession()
    if (current?.token !== stored.token || current.pds.did !== stored.pds.did || current.pds.refresh_jwt !== key) return current
    const pds = await refresh({ data: current.pds })
    {
      const latest = readStoredSession()
      const stillCurrent = latest?.token === stored.token && latest.pds.did === stored.pds.did && latest.pds.refresh_jwt === key
      if (pds === null) {
        if (stillCurrent && locks) writeStoredSession(null)
        // Without cross-tab locks a rejection cannot prove another tab is not
        // still rotating this token. Never destroy its in-flight session.
        if (stillCurrent && !locks) throw new Error('登录状态已失效，请重新登录。')
        return stillCurrent ? null : latest
      }
      if (!isPdsSession(pds) || pds.did !== stored.pds.did) throw new Error('登录状态刷新失败，请重新登录。')
      if (!stillCurrent) return latest
      const updated = { ...latest, pds }
      writeStoredSession(updated)
      return updated
    }
  }
  // One origin-wide lock, with no credentials in its name/queryable metadata.
  const request = Promise.resolve(locks ? locks.request('xiangjian-pds-session-refresh', run) : run())
    .finally(() => {
      if (pendingRefreshes.get(key) === request) pendingRefreshes.delete(key)
    })
  pendingRefreshes.set(key, request)
  return request
}

export async function logoutStoredSession(
  stored: RiceSession,
  revoke: (input: { data: { token: string; refreshJwt: string } }) => Promise<{ riceRevoked: boolean; pdsRevoked: boolean }> = logoutRice,
) {
  const run = async () => {
    const latest = readStoredSession()
    if (!latest || latest.token !== stored.token || latest.pds.did !== stored.pds.did) {
      return { riceRevoked: true, pdsRevoked: true }
    }
    // Clear locally before any network I/O; late refreshes cannot revive it.
    writeStoredSession(null)
    return revoke({ data: { token: latest.token, refreshJwt: latest.pds.refresh_jwt } })
  }
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return locks ? locks.request('xiangjian-pds-session-refresh', run) : run()
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<RiceSession | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')

  useEffect(() => {
    let active = true
    let revision = 0
    const sync = async () => {
      const currentRevision = ++revision
      const stored = readStoredSession()
      setSession(stored)
      setIsReady(true)
      setRecoveryError('')
      if (stored) return
      const credentials = readStoredCredentials()
      if (!credentials) {
        if (readStoredValue() !== null) setRecoveryError('登录信息不完整，请重新登录。')
        return
      }
      setIsReady(false)
      try {
        const updated = await refreshStoredUser(credentials, getCurrentUser, () => active && currentRevision === revision)
        if (!active || currentRevision !== revision) return
        setSession(updated)
        setIsReady(true)
      } catch {
        if (!active || currentRevision !== revision) return
        setRecoveryError('登录状态暂时无法恢复，请稍后重试。')
        setIsReady(true)
      }
    }
    const storageChanged = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) void sync()
    }
    const stopSync = listen(window, CHANGE_EVENT, sync)
    const stopStorage = listen(window, 'storage', storageChanged)
    void sync()
    const stopWatching = watchPdsSessionLifetime(async () => {
      const current = readStoredSession()
      // A network failure preserves local credentials; the watcher performs bounded backoff.
      if (current) await refreshStoredSession(current).catch(() => undefined)
    })
    return () => {
      active = false
      stopWatching()
      stopSync()
      stopStorage()
    }
  }, [])

  return (
    <SessionContext.Provider value={{ session, isReady, recoveryError, saveSession: writeStoredSession }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useStoredSession() {
  const state = useContext(SessionContext)
  if (!state) throw new Error('useStoredSession 必须在 SessionProvider 内使用')
  return state
}
