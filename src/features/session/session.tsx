import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import type { RiceSession, RiceUser } from '~/lib/models'

import { getCurrentUser, refreshPdsSession } from './api'
import { hasSessionCredentials, isPdsSession, isRiceSession, isSessionUser, type SessionCredentials } from './session-data'

const STORAGE_KEY = 'xiangjian-rice-session'
const CHANGE_EVENT = 'xiangjian-session-change'
const PDS_REFRESH_MARGIN_MS = 60_000
const pendingRefreshes = new Map<string, Promise<RiceSession | null>>()
type PdsRefresh = (input: {
  data: RiceSession['pds']
}) => Promise<RiceSession['pds'] | null>

type SessionState = {
  session: RiceSession | null
  isReady: boolean
  recoveryError: string
  saveSession: (session: RiceSession | null) => void
}

const SessionContext = createContext<SessionState | null>(null)

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

// Repair an incomplete cache using its existing credentials, never a different account's profile.
export async function refreshStoredUser(
  stored: SessionCredentials,
  loadUser: (input: { data: string }) => Promise<RiceUser | null> = getCurrentUser,
  isCurrent: () => boolean = () => true,
) {
  const user = await loadUser({ data: stored.token })
  const latest = readStoredCredentials()
  if (!isCurrent() || latest?.token !== stored.token || latest.pds.did !== stored.pds.did) return readStoredSession()
  if (user === null) {
    writeStoredSession(null)
    return null
  }
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
  const schedule = () => {
    clearTimeout(timer)
    if (!active) return
    const stored = readStoredSession()
    const expiresAt = stored && tokenExpiresAt(stored.pds.access_jwt)
    if (expiresAt && expiresAt > Date.now() + PDS_REFRESH_MARGIN_MS) {
      timer = setTimeout(check, Math.min(expiresAt - Date.now() - PDS_REFRESH_MARGIN_MS, 2_147_483_647))
    }
  }
  const runSync = () => {
    if (pending) return
    pending = sync().finally(() => {
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
  window.addEventListener(CHANGE_EVENT, check)
  window.addEventListener('storage', storageChanged)
  window.addEventListener('pageshow', check)
  document.addEventListener('visibilitychange', check)
  check()
  return () => {
    active = false
    clearTimeout(timer)
    window.removeEventListener(CHANGE_EVENT, check)
    window.removeEventListener('storage', storageChanged)
    window.removeEventListener('pageshow', check)
    document.removeEventListener('visibilitychange', check)
  }
}

export function refreshStoredSession(
  stored: RiceSession,
  refresh: PdsRefresh = refreshPdsSession,
) {
  if (!isRiceSession(stored)) return Promise.reject(new Error('登录信息不完整，请重新登录。'))
  const key = stored.pds.refresh_jwt
  const pending = pendingRefreshes.get(key)
  if (pending) return pending

  const request = refresh({ data: stored.pds })
    .then((pds) => {
      const latest = readStoredSession()
      const stillCurrent = latest?.token === stored.token &&
        latest.pds.did === stored.pds.did && latest.pds.refresh_jwt === key
      if (pds === null) {
        if (stillCurrent) writeStoredSession(null)
        return stillCurrent ? null : latest
      }
      if (!isPdsSession(pds) || pds.did !== stored.pds.did) throw new Error('登录状态刷新失败，请重新登录。')
      const refreshed = { ...stored, pds }
      if (stillCurrent) {
        writeStoredSession({ ...latest, pds })
      }
      return refreshed
    })
    .finally(() => {
      if (pendingRefreshes.get(key) === request) pendingRefreshes.delete(key)
    })
  pendingRefreshes.set(key, request)
  return request
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
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', storageChanged)
    void sync()
    const stopWatching = watchPdsSessionLifetime(async () => {
      const current = readStoredSession()
      // A network failure leaves the existing session usable; no probing or retry loop.
      if (current) await refreshStoredSession(current).catch(() => undefined)
    })
    return () => {
      active = false
      stopWatching()
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', storageChanged)
    }
  }, [])

  const saveSession = useCallback((next: RiceSession | null) => {
    writeStoredSession(next)
  }, [])

  return (
    <SessionContext.Provider value={{ session, isReady, recoveryError, saveSession }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useStoredSession() {
  const state = useContext(SessionContext)
  if (!state) throw new Error('useStoredSession 必须在 SessionProvider 内使用')
  return state
}
