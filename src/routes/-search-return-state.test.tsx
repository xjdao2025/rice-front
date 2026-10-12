import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'

type Location = { pathname: string; search: { q?: string }; state: { __TSR_key: string } }
type Effect = { deps?: readonly unknown[]; cleanup?: () => void }
const mock = vi.hoisted(() => ({
  session: null as RiceSession | null, entryKey: '', q: undefined as string | undefined,
  pending: undefined as Location | undefined, resolved: undefined as Location | undefined,
  hooks: [] as unknown[], index: 0, effects: [] as Array<() => void>, componentKey: '',
  navigate: vi.fn(), tasks: vi.fn(), posts: vi.fn(), events: vi.fn(), nodes: vi.fn(), users: vi.fn(),
}))
vi.mock('~/features/session/session', () => ({ useStoredSession: () => ({ session: mock.session }) }))
vi.mock('~/features/tasks/api', () => ({ getTaskPage: mock.tasks }))
vi.mock('~/features/feed/api', () => ({ getPosts: mock.posts }))
vi.mock('~/features/events/api', () => ({ getEvents: mock.events }))
vi.mock('~/features/nodes/api', () => ({ getNodes: mock.nodes }))
vi.mock('~/features/social/api', () => ({ searchUsers: mock.users }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  Link: () => null,
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({ q: mock.q }), useNavigate: () => mock.navigate }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => {
    const current = { pathname: '/search', search: { q: mock.q }, state: { __TSR_key: mock.entryKey } }
    return select({ location: mock.pending ?? current, resolvedLocation: mock.resolved ?? current })
  },
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mock.index++
    if (!(index in mock.hooks)) mock.hooks[index] = typeof initial === 'function' ? initial() : initial
    const hooks = mock.hooks
    return [hooks[index], (value: unknown) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useRef: (initial: unknown) => {
    const index = mock.index++
    return mock.hooks[index] ?? (mock.hooks[index] = { current: initial })
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = mock.index++
    const previous = mock.hooks[index] as Effect | undefined
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      mock.effects.push(() => {
        previous?.cleanup?.()
        mock.hooks[index] = { deps, cleanup: effect() } as Effect
      })
    }
  },
}))

import { SearchPage } from './search'

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function leave() {
  for (const value of mock.hooks) {
    if (value && typeof value === 'object' && 'cleanup' in value && typeof value.cleanup === 'function') value.cleanup()
  }
  mock.hooks = []; mock.effects = []; mock.componentKey = ''
}
function render() {
  const parent = SearchPage()
  if (mock.componentKey !== parent.key) { if (mock.componentKey) leave(); mock.componentKey = String(parent.key) }
  mock.index = 0
  const tree = (parent.type as (props: typeof parent.props) => ReactNode)(parent.props)
  const effects = mock.effects.splice(0)
  effects.forEach((effect) => effect())
  return elements(tree)
}
const field = () => render().find((node) => node.props.placeholder)?.props
const button = (label: string) => render().find((node) => node.props.label === label)?.props
const groups = () => render().filter((node) => typeof node.props.count === 'number').map((node) => ({ title: node.props.title, count: node.props.count, hasMore: node.props.hasMore }))
async function settle() { await Promise.resolve(); await Promise.resolve(); render() }
async function search(value = '乡建') {
  ;(field()!.onChange as (value: string) => void)(value)
  ;(button('搜索')!.clickAction as () => void)()
  render(); await settle()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.stubGlobal('window', {})
  mock.session = { user: { id: 'alice' }, token: 'alice-token', pds: { did: 'did:alice', access_jwt: 'alice-jwt' } } as RiceSession
  mock.entryKey = `search-${Math.random()}`; mock.q = undefined; mock.pending = undefined; mock.resolved = undefined
  mock.navigate.mockImplementation(({ search }: { search: { q: string }; replace: boolean }) => {
    leave(); mock.entryKey = `${mock.entryKey}-replace`; mock.q = search.q
    return Promise.resolve()
  })
  mock.tasks.mockResolvedValue({ data: [{ id: 'task-1' }], meta: { next_cursor: 'tasks-next' } })
  mock.posts.mockResolvedValue({ posts: [{ uri: 'post-1' }], cursor: 'posts-next' })
  mock.events.mockResolvedValue({ data: [{ id: 'event-1' }], meta: { next_cursor: 'events-next' } })
  mock.nodes.mockResolvedValue([{ id: 'node-1' }])
  mock.users.mockResolvedValue({ data: [{ id: 'user-1', did: 'did:bob', handle: 'bob.example' }], meta: { next_cursor: 'users-next' } })
})
afterEach(() => { leave(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('keeps the keyword, all result groups and loaded pages on a detail round trip without re-searching', async () => {
  await search('  乡建  ')
  expect(mock.navigate).toHaveBeenCalledWith({ search: { q: '乡建' }, replace: true })
  mock.tasks.mockResolvedValueOnce({ data: [{ id: 'task-2' }], meta: { next_cursor: 'tasks-third' } })
  await (button('更多任务')!.clickAction as () => Promise<void>)(); render()
  mock.posts.mockResolvedValueOnce({ posts: [{ uri: 'post-2' }], cursor: null })
  await (button('更多帖子')!.clickAction as () => Promise<void>)(); render()
  // Keep edits as well as the keyword used for the current result list.
  ;(field()!.onChange as (value: string) => void)('乡建草稿'); render()
  const previous = groups()
  const key = mock.entryKey
  leave() // Open a result, then browser Back restores the same history entry.
  mock.entryKey = key
  expect(field()!.value).toBe('乡建草稿')
  expect(groups()).toEqual(previous)
  expect(groups()).toEqual([
    { title: '帖子', count: 2, hasMore: false }, { title: '任务', count: 2, hasMore: true },
    { title: '活动', count: 1, hasMore: true }, { title: '节点', count: 1, hasMore: undefined },
    { title: '用户', count: 1, hasMore: true },
  ])
  await settle()
  expect(mock.tasks).toHaveBeenCalledTimes(2); expect(mock.posts).toHaveBeenCalledTimes(2)
  for (const api of [mock.events, mock.nodes, mock.users]) expect(api).toHaveBeenCalledTimes(1)
  await (button('更多任务')!.clickAction as () => Promise<void>)()
  expect(mock.tasks).toHaveBeenLastCalledWith({ data: { q: '乡建', token: 'alice-token', before: 'tasks-third', limit: 10 } })
})

it('starts empty on a new search visit, while a shared query URL still loads its results', async () => {
  await search()
  leave(); mock.entryKey = 'new-search'; mock.q = undefined
  expect(field()!.value).toBe(''); expect(groups()).toEqual([])
  expect(mock.tasks).toHaveBeenCalledTimes(1)
  leave(); mock.entryKey = 'shared-search'; mock.q = '乡建'
  render(); await settle()
  expect(field()!.value).toBe('乡建'); expect(groups()).toHaveLength(5)
  expect(mock.tasks).toHaveBeenCalledTimes(2)
})

it('does not restore an account’s results for another user at the same history entry', async () => {
  await search()
  leave()
  const next = deferred<{ data: unknown[]; meta: { next_cursor: null } }>()
  mock.tasks.mockReturnValueOnce(next.promise)
  mock.session = { ...mock.session, user: { id: 'carol' }, token: 'carol-token' } as RiceSession
  render()
  expect(groups()).toEqual([])
  expect(mock.tasks).toHaveBeenLastCalledWith({ data: { q: '乡建', token: 'carol-token', limit: 10 } })
  next.resolve({ data: [], meta: { next_cursor: null } }); await settle()
  expect(groups().find((group) => group.title === '任务')?.count).toBe(0)
})

it('keeps completed pages if another page is pending when a result is opened', async () => {
  await search()
  const pending = deferred<{ data: unknown[]; meta: { next_cursor: null } }>()
  mock.tasks.mockReturnValueOnce(pending.promise)
  const more = (button('更多任务')!.clickAction as () => Promise<void>)()
  render(); leave(); render()
  expect(groups().find((group) => group.title === '任务')).toEqual({ title: '任务', count: 1, hasMore: true })
  expect(button('更多任务')!.isDisabled).toBe(false)
  pending.resolve({ data: [{ id: 'late-task' }], meta: { next_cursor: null } }); await more; render()
  expect(groups().find((group) => group.title === '任务')?.count).toBe(1)
  expect(mock.tasks).toHaveBeenCalledTimes(2)
})

it('ignores a late first search after leaving and retries that incomplete query on return', async () => {
  const pending = deferred<{ data: unknown[]; meta: { next_cursor: null } }>()
  mock.tasks.mockReturnValueOnce(pending.promise)
  mock.q = '乡建'
  render(); render(); leave()
  pending.resolve({ data: [{ id: 'late-task' }], meta: { next_cursor: null } }); await Promise.resolve(); await Promise.resolve()
  render(); await settle()
  expect(mock.tasks).toHaveBeenCalledTimes(2)
  expect(groups().find((group) => group.title === '任务')?.count).toBe(1)
  expect(render().filter((node) => node.props.task).map((node) => (node.props.task as { id: string }).id)).toEqual(['task-1'])
})

it('retains the visible search visit during a pending detail and restores it before resolvedLocation catches up on return', async () => {
  await search()
  mock.posts.mockResolvedValueOnce({ posts: [{ uri: 'post-2' }], cursor: null })
  await (button('更多帖子')!.clickAction as () => Promise<void>)(); render()
  const searchKey = mock.entryKey
  const detail = { pathname: '/posts', search: {}, state: { __TSR_key: 'pending-detail' } }
  mock.pending = detail
  expect(field()!.value).toBe('乡建')
  expect(groups().find((group) => group.title === '帖子')?.count).toBe(2)
  expect(mock.tasks).toHaveBeenCalledTimes(1); expect(mock.posts).toHaveBeenCalledTimes(2)
  leave() // Loader resolves and the visible search page finally unmounts.
  mock.pending = undefined; mock.resolved = detail; mock.entryKey = searchKey
  expect(field()!.value).toBe('乡建')
  expect(groups().find((group) => group.title === '帖子')?.count).toBe(2)
  mock.resolved = undefined // Router commits resolvedLocation after React renders the destination.
  await settle()
  expect(field()!.value).toBe('乡建')
  expect(groups().find((group) => group.title === '帖子')?.count).toBe(2)
  expect(mock.tasks).toHaveBeenCalledTimes(1); expect(mock.posts).toHaveBeenCalledTimes(2)
})

it('keeps the typed keyword during a pending query replace, then searches the committed query once', async () => {
  const oldLocation = { pathname: '/search', search: {}, state: { __TSR_key: mock.entryKey } }
  ;(field()!.onChange as (value: string) => void)('乡建')
  mock.navigate.mockImplementation(({ search }: { search: { q: string } }) => {
    mock.resolved = oldLocation
    mock.pending = { pathname: '/search', search, state: { __TSR_key: 'replacement-search' } }
    return Promise.resolve()
  })
  ;(button('搜索')!.clickAction as () => void)()
  expect(field()!.value).toBe('乡建')
  expect(mock.tasks).not.toHaveBeenCalled()
  mock.q = '乡建'; mock.entryKey = 'replacement-search'
  render(); await settle()
  expect(field()!.value).toBe('乡建')
  expect(groups()).toHaveLength(5)
  mock.pending = undefined; mock.resolved = undefined
  await settle()
  expect(field()!.value).toBe('乡建')
  expect(mock.tasks).toHaveBeenCalledTimes(1)
})
