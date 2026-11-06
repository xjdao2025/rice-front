import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadPostPage, loadPostThread } from './api'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const post = (n: number) => ({
  uri: `at://did:author:${n}/app.bsky.feed.post/1`, cid: `cid${n}`,
  indexedAt: '2026-10-01T00:00:00.000Z',
  author: { did: `did:author:${n}`, handle: `author${n}.test` },
  record: { text: `post ${n}`, createdAt: '2026-10-01T00:00:00.000Z' },
  likeCount: 0, repostCount: 0, replyCount: 0,
})

afterEach(() => vi.unstubAllGlobals())

describe('bounded feed hydration', () => {
  it('looks up an unliked post once, irrespective of ten-page like/repost histories', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('aerox.feed.listPosts')) return response({ posts: [post(0)] })
      if (url.pathname.endsWith('getPosts')) return response({ posts: [post(0)] })
      if (url.pathname.endsWith('listRecords')) {
        const page = Number(url.searchParams.get('cursor') ?? 0)
        return response({ records: [], ...(page < 9 ? { cursor: String(page + 1) } : {}) })
      }
      return response({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const feed = await loadPostPage({ did: 'did:reader', accessJwt: 'reader-token', cursor: 'next' })
    expect(feed.posts[0].viewer).toBeUndefined()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('getPosts'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('listRecords'))).toBe(false)
  })

  it('deduplicates subjects and batches viewer reads in groups of at most 25', async () => {
    const posts = Array.from({ length: 51 }, (_, n) => post(n))
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('aerox.feed.listPosts')) return response({ posts: [...posts, posts[0]] })
      if (url.pathname.endsWith('getPosts')) {
        expect(url.pathname).toBe('/pds/xrpc/app.bsky.feed.getPosts')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer reader-token')
        const uris = url.searchParams.getAll('uris')
        batches.push(uris)
        return response({ posts: posts.filter(p => uris.includes(p.uri)).map(p => ({
          ...p, viewer: { like: `at://did:reader/app.bsky.feed.like/${p.cid}` },
        })) })
      }
      return response({ data: [] })
    }))
    const feed = await loadPostPage({ did: 'did:reader', accessJwt: 'reader-token', cursor: 'next' })
    expect(batches.map(batch => batch.length)).toEqual([25, 25, 1])
    expect(new Set(batches.flat()).size).toBe(51)
    expect(feed.posts).toHaveLength(52)
    expect(feed.posts.every(p => p.viewer?.like?.startsWith('at://did:reader/'))).toBe(true)
  })

  it('batches unique authors and reposters, without per-author profile or wallet reads', async () => {
    const posts = Array.from({ length: 101 }, (_, n) => post(n))
    const reposter = { did: 'did:reposter', handle: 'reposter.test' }
    const batches: string[][] = []
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('aerox.feed.listPosts')) return response({ posts: [...posts, {
        ...posts[0], reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: reposter, indexedAt: posts[0].indexedAt },
      }] })
      if (url.pathname === '/api/users/profiles') {
        expect(init?.method).toBe('POST')
        expect(new Headers(init?.headers).has('Authorization')).toBe(false)
        const { dids } = JSON.parse(String(init?.body)) as { dids: string[] }
        batches.push(dids)
        return response({ data: dids.map(did => ({ did, nickname: `Rice ${did}`, avatar: { url: '/avatar.webp' } })) })
      }
      throw new Error(`unexpected per-item request: ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const feed = await loadPostPage({ cursor: 'next' })
    expect(batches.map(batch => batch.length)).toEqual([100, 2])
    expect(new Set(batches.flat()).size).toBe(102)
    expect(feed.posts[0].author.displayName).toMatch(/^Rice /)
    expect(feed.posts.find(p => p.reason)?.reason?.by.displayName).toBe('Rice did:reposter')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reuses authenticated thread viewer state without any viewer hydration request', async () => {
    const root = { ...post(0), viewer: { like: 'at://did:reader/app.bsky.feed.like/1' } }
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).includes('getPostThread')) return response({ thread: { post: root } })
      return response({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect((await loadPostThread({ uri: root.uri, did: 'did:reader', accessJwt: 'reader-token' })).post.viewer).toEqual(root.viewer)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.some(([url]) => /getPosts|listRecords/.test(String(url)))).toBe(false)
  })

  it('propagates expired reader tokens and does not fall back to history scans', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => String(input).includes('aerox.feed.listPosts')
      ? response({ posts: [post(0)] })
      : response({ error: 'ExpiredToken' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadPostPage({ did: 'did:reader', accessJwt: 'expired', cursor: 'next' })).rejects.toMatchObject({ status: 401, code: 'ExpiredToken' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
