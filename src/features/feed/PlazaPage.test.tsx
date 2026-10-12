import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PostFeed, PostView, RiceSession } from '~/lib/models'

type Effect = { deps?: readonly unknown[]; cleanup?: () => void }
const mock = vi.hoisted(() => ({
  session: null as RiceSession | null,
  hooks: [] as unknown[], parentHooks: [] as unknown[], parent: false,
  index: 0, effects: [] as Array<() => void>, componentKey: '',
  listeners: new Map<string, Set<() => void>>(),
  getPosts: vi.fn(), readCache: vi.fn(), writeCache: vi.fn(),
}))
vi.mock('~/features/session/session', () => ({ useStoredSession: () => ({ session: mock.session, isReady: true }) }))
vi.mock('./api', () => ({ getPosts: mock.getPosts, readCachedFeed: mock.readCache, writeCachedFeed: mock.writeCache }))
vi.mock('~/components/PostList', () => ({ PostList: () => null }))
vi.mock('~/components/AutoLoadMore', () => ({ AutoLoadMore: () => null }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mock.index++
    const hooks = mock.parent ? mock.parentHooks : mock.hooks
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], (value: unknown) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useRef: (initial: unknown) => {
    const index = mock.index++
    const hooks = mock.parent ? mock.parentHooks : mock.hooks
    return hooks[index] ?? (hooks[index] = { current: initial })
  },
  useMemo: (calculate: () => unknown, deps: readonly unknown[]) => {
    const index = mock.index++
    const hooks = mock.parent ? mock.parentHooks : mock.hooks
    const previous = hooks[index] as { deps: readonly unknown[]; value: unknown } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) hooks[index] = { deps, value: calculate() }
    return (hooks[index] as { value: unknown }).value
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = mock.index++
    const hooks = mock.parent ? mock.parentHooks : mock.hooks
    const previous = hooks[index] as Effect | undefined
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      mock.effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() } as Effect })
    }
  },
}))

import { PlazaPage } from './PlazaPage'

function feed(id: string, tagged = true, cursor: string | null = '2'): PostFeed {
  return { posts: [{
    uri: `at://did:alice/app.bsky.feed.post/${id}`, cid: id,
    author: { did: 'did:alice', handle: 'alice.example' },
    record: { text: tagged ? `#活动 ${id}` : id, createdAt: '2026-10-13T00:00:00Z', ...(tagged ? { xjdaoCategory: 'activity' } : {}) },
    indexedAt: '2026-10-13T00:00:00Z', likeCount: 0, repostCount: 0, replyCount: 0,
  } as PostView], cursor }
}
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
function visit(props: Parameters<typeof PlazaPage>[0]) {
  const render = () => {
    mock.parent = true; mock.index = 0
    const parent = PlazaPage(props)
    if (mock.componentKey !== parent.key) { if (mock.componentKey) leave(); mock.componentKey = String(parent.key) }
    mock.parent = false; mock.index = 0
    const tree = (parent.type as (props: typeof parent.props) => ReactNode)(parent.props)
    mock.effects.splice(0).forEach((effect) => effect())
    return elements(tree)
  }
  return {
    render,
    posts: () => render().find((node) => Array.isArray(node.props.posts))!.props.posts as PostView[],
    more: () => render().find((node) => typeof node.props.onLoadMore === 'function')!.props.onLoadMore as () => Promise<void>,
    settle: async () => { await Promise.resolve(); await Promise.resolve(); render() },
    refresh: () => { mock.listeners.get('posts-changed')?.forEach((listener) => listener()); render() },
  }
}

beforeEach(() => {
  mock.session = { user: { id: 'alice' }, token: 'alice-token', pds: { did: 'did:alice', access_jwt: 'alice-jwt' } } as RiceSession
  mock.hooks = []; mock.parentHooks = []; mock.effects = []; mock.componentKey = ''; mock.listeners.clear()
  mock.readCache.mockReturnValue(feed('full-home', false))
  mock.getPosts.mockResolvedValue(feed('tag-first'))
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: () => void) => {
      if (!mock.listeners.has(name)) mock.listeners.set(name, new Set())
      mock.listeners.get(name)!.add(listener)
    },
    removeEventListener: (name: string, listener: () => void) => mock.listeners.get(name)?.delete(listener),
  })
})
afterEach(() => { leave(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('keeps tag results isolated from the full-home cache on initial load, refresh and pagination', async () => {
  const page = visit({ initialFeed: feed('tag-ssr'), banners: [], tag: '活动' })
  page.render(); await page.settle()
  expect(page.posts().map((post) => post.record.text)).toEqual(['#活动 tag-first'])
  expect(mock.getPosts).toHaveBeenLastCalledWith({ data: { accessJwt: 'alice-jwt', did: 'did:alice', tag: '活动' } })
  expect(mock.readCache).not.toHaveBeenCalled(); expect(mock.writeCache).not.toHaveBeenCalled()

  mock.getPosts.mockResolvedValueOnce(feed('tag-refreshed'))
  page.refresh(); await page.settle()
  expect(page.posts().map((post) => post.record.text)).toEqual(['#活动 tag-refreshed'])
  expect(mock.getPosts).toHaveBeenCalledTimes(2)
  expect(mock.getPosts).toHaveBeenLastCalledWith({ data: { accessJwt: 'alice-jwt', did: 'did:alice', tag: '活动' } })
  expect(mock.readCache).not.toHaveBeenCalled(); expect(mock.writeCache).not.toHaveBeenCalled()

  mock.getPosts.mockResolvedValueOnce(feed('tag-more', true, null))
  await page.more()(); page.render()
  expect(page.posts().map((post) => post.record.text)).toEqual(['#活动 tag-refreshed', '#活动 tag-more'])
  expect(mock.getPosts).toHaveBeenLastCalledWith({ data: { accessJwt: 'alice-jwt', did: 'did:alice', tag: '活动', cursor: '2' } })
  expect(mock.readCache).not.toHaveBeenCalled(); expect(mock.writeCache).not.toHaveBeenCalled()
})

it('uses the server-rendered tag feed for guests and still refreshes only that tag', async () => {
  mock.session = null
  const page = visit({ initialFeed: feed('tag-ssr'), banners: [], tag: '活动' })
  page.render(); await page.settle()
  expect(page.posts().map((post) => post.record.text)).toEqual(['#活动 tag-ssr'])
  expect(mock.getPosts).not.toHaveBeenCalled()
  page.refresh(); await page.settle()
  expect(page.posts().map((post) => post.record.text)).toEqual(['#活动 tag-first'])
  expect(mock.getPosts).toHaveBeenCalledWith({ data: { accessJwt: undefined, did: undefined, tag: '活动' } })
  expect(mock.readCache).not.toHaveBeenCalled(); expect(mock.writeCache).not.toHaveBeenCalled()
})

it('continues to reuse the full-home cache for the ordinary plaza, including post-change refreshes', async () => {
  const page = visit({ initialFeed: feed('older-ssr', false), banners: [] })
  page.render(); await page.settle()
  expect(page.posts().map((post) => post.record.text)).toEqual(['full-home'])
  mock.readCache.mockReturnValue(feed('full-home-refreshed', false))
  page.refresh(); await page.settle()
  expect(page.posts().map((post) => post.record.text)).toEqual(['full-home-refreshed'])
  expect(mock.readCache).toHaveBeenCalledWith('did:alice')
  expect(mock.getPosts).not.toHaveBeenCalled(); expect(mock.writeCache).not.toHaveBeenCalled()
})
