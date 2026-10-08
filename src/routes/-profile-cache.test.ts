import { createMemoryHistory, type AnyRoute } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'

const state = vi.hoisted(() => ({ session: null as RiceSession | null }))
const api = vi.hoisted(() => ({ user: vi.fn(), wallet: vi.fn(), nodes: vi.fn() }))
vi.mock('~/features/session/session', () => ({ readStoredSession: () => state.session }))
vi.mock('~/features/session/api', () => ({ getCurrentUser: api.user }))
vi.mock('~/features/grains/api', () => ({ getWallet: api.wallet }))
vi.mock('~/features/nodes/api', () => ({ getNodes: api.nodes }))
vi.mock('~/features/profile/ProfilePage', () => ({ ProfilePage: () => null }))

// Exercise the actual private route's loader and cache with only network calls mocked.
vi.mock('../routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router')
  const { Route } = await import('./me.index')
  const options: AnyRoute['options'] = Route.options
  const root = createRootRoute()
  const home = createRoute({ getParentRoute: () => root, path: '/' })
  const parent = createRoute({ getParentRoute: () => root, path: '/me' })
  const profile = createRoute({
    getParentRoute: () => parent, path: '/',
    loader: options.loader,
    loaderDeps: options.loaderDeps,
    beforeLoad: options.beforeLoad,
    staleTime: options.staleTime,
    preloadStaleTime: options.preloadStaleTime,
    ssr: options.ssr,
  })
  return { routeTree: root.addChildren([home, parent.addChildren([profile])]) }
})

import { getRouter } from '../router'

function session(accountId: string, token = `token-${accountId}`) {
  return { token, user: { id: accountId } } as RiceSession
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function readyRouter() {
  const router = getRouter()
  router.update({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
    origin: 'http://localhost',
    scrollRestoration: false,
  })
  await router.load()
  return router
}

beforeEach(() => {
  vi.useFakeTimers()
  state.session = session('a')
  api.user.mockReset().mockResolvedValue({ id: 'a', nickname: '甲' })
  api.wallet.mockReset().mockResolvedValue({ balance: 100, frozen: 0, earned: 100, entries: [] })
  api.nodes.mockReset().mockResolvedValue([])
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('private profile route cache', () => {
  it('prefetches separate wallets for managed communities and excludes member communities', async () => {
    api.nodes.mockResolvedValue([
      { id: 'one', name: '一号社区', role: 'admin' },
      { id: 'joined', name: '参加的社区', role: 'member' },
      { id: 'two', name: '二号社区', role: 'admin' },
    ])
    api.wallet.mockImplementation(({ data }) => Promise.resolve({ balance: data.nodeId === 'one' ? 500 : data.nodeId === 'two' ? 80 : 100, entries: [] }))
    const router = await readyRouter()
    await router.navigate({ to: '/me' })
    expect(api.nodes).toHaveBeenCalledExactlyOnceWith({ data: { token: 'token-a', mine: 'managed' } })
    expect(api.wallet).toHaveBeenCalledTimes(3)
    expect(api.wallet).not.toHaveBeenCalledWith({ data: { token: 'token-a', nodeId: 'joined' } })
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: {
      wallet: { balance: 100 },
      communities: [
        { id: 'one', name: '一号社区', wallet: { balance: 500 } },
        { id: 'two', name: '二号社区', wallet: { balance: 80 } },
      ],
    } })
  })

  it('keeps the personal wallet when a community wallet fails without inventing a zero balance', async () => {
    api.nodes.mockResolvedValue([{ id: 'one', name: '一号社区', role: 'admin' }])
    api.wallet.mockImplementation(({ data }) => data.nodeId ? Promise.reject(new Error('forbidden')) : Promise.resolve({ balance: 100 }))
    const router = await readyRouter()
    await router.navigate({ to: '/me' })
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: {
      wallet: { balance: 100 },
      communities: [{ id: 'one', name: '一号社区', wallet: null, error: '节点稻米暂时无法加载，请稍后重试。' }],
    }, error: '' })
  })

  it.each(['revoked', 'unavailable'])('drops old community data on refresh when managed communities are %s even if the personal wallet also fails', async (reason) => {
    api.nodes.mockResolvedValueOnce([{ id: 'one', name: '一号社区', role: 'admin' }])
    const router = await readyRouter()
    await router.navigate({ to: '/me' })
    if (reason === 'unavailable') api.nodes.mockRejectedValueOnce(new Error('offline'))
    api.wallet.mockRejectedValueOnce(new Error('个人钱包暂时不可用'))
    await router.invalidate({ filter: (match) => match.routeId === '/me/' })
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { wallet: { balance: 100 }, communities: [] } })
    if (reason === 'unavailable') expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { communityError: '暂时无法加载管理的节点，请稍后重试。' } })
  })

  it('discards community wallets completing after a new session starts', async () => {
    const oldWallet = deferred<{ balance: number }>()
    api.nodes.mockResolvedValueOnce([{ id: 'one', name: '一号社区', role: 'admin' }])
    api.wallet.mockImplementation(({ data }) => data.nodeId ? oldWallet.promise : Promise.resolve({ balance: 100 }))
    const router = await readyRouter()
    const preload = router.preloadRoute({ to: '/me' })
    await vi.advanceTimersByTimeAsync(0)
    state.session = session('a', 'new-token-a')
    await router.navigate({ to: '/me' })
    oldWallet.resolve({ balance: 500 })
    const oldMatches = await preload
    expect(oldMatches?.at(-1)?.loaderData).toEqual({ initialData: null, error: '' })
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { sessionToken: 'new-token-a', communities: [] } })
  })

  it('does not reuse guest preloads after login, then reuses the current session on return', async () => {
    state.session = null
    const router = await readyRouter()
    await router.preloadRoute({ to: '/me' })
    expect(api.wallet).not.toHaveBeenCalled()

    state.session = session('a')
    await router.preloadRoute({ to: '/me' })
    await router.navigate({ to: '/me' })
    await router.navigate({ to: '/' })
    await router.navigate({ to: '/me' })

    expect(api.user).toHaveBeenCalledExactlyOnceWith({ data: 'token-a' })
    expect(api.wallet).toHaveBeenCalledExactlyOnceWith({ data: { token: 'token-a' } })
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { accountId: 'a', wallet: { balance: 100 } } })
  })

  it('keeps the source for first load and keeps cached data during a background refresh', async () => {
    const router = await readyRouter()
    const first = deferred<{ balance: number }>()
    api.wallet.mockReturnValueOnce(first.promise)
    const navigation = router.navigate({ to: '/me' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(router.state.resolvedLocation?.pathname).toBe('/')
    first.resolve({ balance: 100 })
    await navigation
    const previous = router.state.matches.at(-1)?.loaderData

    await router.navigate({ to: '/' })
    await vi.advanceTimersByTimeAsync(30_001)
    const refreshed = deferred<{ balance: number }>()
    api.wallet.mockReturnValueOnce(refreshed.promise)
    await router.navigate({ to: '/me' })
    expect(router.state.resolvedLocation?.pathname).toBe('/me')
    expect(router.state.matches.at(-1)?.loaderData).toBe(previous)
    refreshed.resolve({ balance: 120 })
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { wallet: { balance: 120 } } })

    await router.invalidate({ filter: (match) => match.routeId === '/me/' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.wallet).toHaveBeenCalledTimes(3)
  })

  it('does not share cached data across accounts, logout, or a new login session', async () => {
    const router = await readyRouter()
    await router.navigate({ to: '/me' })
    await router.navigate({ to: '/' })
    state.session = session('b')
    const nextWallet = deferred<{ balance: number }>()
    api.user.mockResolvedValueOnce({ id: 'b', nickname: '乙' })
    api.wallet.mockReturnValueOnce(nextWallet.promise)
    const navigation = router.navigate({ to: '/me' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(router.state.resolvedLocation?.pathname).toBe('/')
    nextWallet.resolve({ balance: 9 })
    await navigation
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { accountId: 'b', wallet: { balance: 9 } } })

    await router.navigate({ to: '/' })
    state.session = null
    await router.navigate({ to: '/me' })
    expect(router.state.matches.at(-1)?.loaderData).toEqual({ initialData: null, error: '' })
    await router.navigate({ to: '/' })
    state.session = session('a', 'new-token-a')
    await router.navigate({ to: '/me' })
    expect(api.wallet).toHaveBeenCalledTimes(3)
    expect(api.wallet).toHaveBeenLastCalledWith({ data: { token: 'new-token-a' } })
  })

  it.each([
    { failure: new Error('钱包服务暂时不可用'), message: '钱包服务暂时不可用' },
    { failure: new TypeError('Failed to fetch'), message: '网络连接失败，请检查网络后重试。' },
  ])('keeps the same-session successful snapshot after a failed refresh: $message', async ({ failure, message }) => {
    const router = await readyRouter()
    await router.navigate({ to: '/me' })
    api.wallet.mockRejectedValueOnce(failure)
    await router.invalidate({ filter: (match) => match.routeId === '/me/' })
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { accountId: 'a', wallet: { balance: 100 } }, error: message })

    await router.navigate({ to: '/' })
    await router.navigate({ to: '/me' })
    expect(api.wallet).toHaveBeenCalledTimes(2)
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { accountId: 'a', wallet: { balance: 100 } }, error: message })

    await router.navigate({ to: '/' })
    state.session = session('a', 'new-token-a')
    api.wallet.mockRejectedValueOnce(new Error('新会话请求失败'))
    await router.navigate({ to: '/me' })
    expect(router.state.matches.at(-1)?.loaderData).toEqual({ initialData: null, error: '新会话请求失败' })
  })

  it('discards a response that finishes after the user changes account', async () => {
    const router = await readyRouter()
    const oldWallet = deferred<{ balance: number }>()
    api.wallet.mockReturnValueOnce(oldWallet.promise)
    const preload = router.preloadRoute({ to: '/me' })
    await vi.advanceTimersByTimeAsync(0)
    state.session = session('b')
    api.user.mockResolvedValueOnce({ id: 'b' })
    api.wallet.mockResolvedValueOnce({ balance: 9 })
    await router.navigate({ to: '/me' })
    oldWallet.resolve({ balance: 100 })
    const oldMatches = await preload
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ initialData: { accountId: 'b', wallet: { balance: 9 } } })
    expect(oldMatches?.at(-1)?.loaderData).toEqual({ initialData: null, error: '' })
  })
})
