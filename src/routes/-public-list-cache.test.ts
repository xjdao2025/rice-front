import { createMemoryHistory, type AnyRoute } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ tasks: vi.fn(), events: vi.fn() }))
vi.mock('~/features/tasks/api', () => ({ getTaskPage: api.tasks }))
vi.mock('~/features/events/api', () => ({ getEvents: api.events }))
vi.mock('~/features/tasks/TasksPage', () => ({ TasksPage: () => null }))
vi.mock('~/features/events/EventsPage', () => ({ EventsPage: () => null }))

// Use the real routes' loaders and cache settings, with only their network calls mocked.
vi.mock('../routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router')
  const { Route: taskRoute } = await import('./tasks.index')
  const { Route: eventRoute } = await import('./events')
  // File-route parent types belong to the generated tree; this fixture keeps their options.
  const taskOptions: AnyRoute['options'] = taskRoute.options
  const eventOptions: AnyRoute['options'] = eventRoute.options
  const root = createRootRoute()
  const home = createRoute({ getParentRoute: () => root, path: '/' })
  const taskParent = createRoute({ getParentRoute: () => root, path: '/tasks' })
  const tasks = createRoute({
    getParentRoute: () => taskParent, path: '/',
    loader: taskOptions.loader,
    beforeLoad: taskOptions.beforeLoad,
    staleTime: taskOptions.staleTime,
    preloadStaleTime: taskOptions.preloadStaleTime,
  })
  const events = createRoute({
    getParentRoute: () => root, path: '/events',
    loader: eventOptions.loader,
    beforeLoad: eventOptions.beforeLoad,
    staleTime: eventOptions.staleTime,
    preloadStaleTime: eventOptions.preloadStaleTime,
  })
  return { routeTree: root.addChildren([home, taskParent.addChildren([tasks]), events]) }
})

import { getRouter } from '../router'

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
  api.tasks.mockReset().mockResolvedValue({ data: [{ id: 'task-1' }], meta: { next_cursor: null } })
  api.events.mockReset().mockResolvedValue({ data: [{ id: 'event-1' }], meta: { next_cursor: null } })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('public list route cache', () => {
  it('reuses preloaded data and quick return visits without another request', async () => {
    const router = await readyRouter()
    await router.preloadRoute({ to: '/tasks' })
    await router.navigate({ to: '/tasks' })
    await router.navigate({ to: '/events' })
    await router.navigate({ to: '/tasks' })
    await router.navigate({ to: '/events' })

    expect(api.tasks).toHaveBeenCalledExactlyOnceWith({ data: { limit: 12, sort: 'published' } })
    expect(api.events).toHaveBeenCalledExactlyOnceWith({ data: {} })
  })

  it('shows a stale cached list immediately while refreshing it in the background', async () => {
    const router = await readyRouter()
    await router.navigate({ to: '/tasks' })
    const previous = router.state.matches.at(-1)?.loaderData
    await router.navigate({ to: '/' })
    await vi.advanceTimersByTimeAsync(30_001)
    const refreshed = deferred<{ data: { id: string }[]; meta: { next_cursor: null } }>()
    api.tasks.mockReturnValueOnce(refreshed.promise)

    await router.navigate({ to: '/tasks' })
    expect(api.tasks).toHaveBeenCalledTimes(2)
    expect(router.state.resolvedLocation?.pathname).toBe('/tasks')
    expect(router.state.matches.at(-1)?.loaderData).toBe(previous)

    refreshed.resolve({ data: [{ id: 'task-2' }], meta: { next_cursor: null } })
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ page: { data: [{ id: 'task-2' }] } })
  })

  it('refreshes active lists after a business change and marks inactive lists stale', async () => {
    const router = await readyRouter()
    await router.navigate({ to: '/events' })
    await router.navigate({ to: '/tasks' })

    await router.invalidate({ filter: (match) => match.routeId === '/tasks/' || match.routeId === '/events' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.tasks).toHaveBeenCalledTimes(2)
    expect(api.events).toHaveBeenCalledTimes(1)

    await router.navigate({ to: '/events' })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.events).toHaveBeenCalledTimes(2)
    expect(api.tasks).toHaveBeenCalledTimes(2)
  })

  it.each(['/tasks', '/events'] as const)('keeps cached %s after a failed refresh and reopening, then clears the error on success', async (to) => {
    const request = to === '/tasks' ? api.tasks : api.events
    const routeId = to === '/tasks' ? '/tasks/' : '/events'
    const router = await readyRouter()
    await router.navigate({ to })
    const previous = router.state.matches.at(-1)?.loaderData
    request.mockRejectedValueOnce(new Error('Network request failed'))
    await router.invalidate({ filter: (match) => match.routeId === routeId })
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)).toMatchObject({ status: 'success', loaderData: { ...previous, refreshError: '暂时无法更新，已保留上次显示的内容。' } })

    await router.navigate({ to: '/' })
    await router.navigate({ to })
    expect(request).toHaveBeenCalledTimes(2)
    expect(router.state.matches.at(-1)).toMatchObject({ status: 'success', loaderData: { ...previous, refreshError: '暂时无法更新，已保留上次显示的内容。' } })

    request.mockResolvedValueOnce({ data: [{ id: 'new-content' }], meta: { next_cursor: null } })
    await router.invalidate({ filter: (match) => match.routeId === routeId })
    await vi.advanceTimersByTimeAsync(0)
    expect(router.state.matches.at(-1)).toMatchObject({ status: 'success', loaderData: { page: { data: [{ id: 'new-content' }] }, refreshError: '' } })
  })

  it.each(['/tasks', '/events'] as const)('keeps the ordinary route error for a first %s visit with no cached data', async (to) => {
    const request = to === '/tasks' ? api.tasks : api.events
    const router = await readyRouter()
    const failure = new Error('服务暂时不可用')
    request.mockRejectedValueOnce(failure)
    await router.navigate({ to })
    expect(router.state.matches.at(-1)).toMatchObject({ status: 'error', error: failure })
  })
})
