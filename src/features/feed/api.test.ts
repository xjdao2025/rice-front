import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PdsImage, RiceSession } from '~/lib/models'
import { MAX_POST_IMAGE_BYTES, newPostRecordKey, pdsBlobUrl, recordKeyFromUri, uploadPdsImage } from '~/lib/pds'

import {
  clearCachedFeed,
  createdPostView,
  createTextPostRecord,
  deleteOwnPostRecord,
  hideDeletedPost,
  isPostHidden,
  loadPostPage,
  loadPostThread,
  normalizePostFeed,
  normalizePostImages,
  normalizePostThread,
  prependCachedPost,
  readCachedFeed,
  readCachedThread,
  readRememberedPost,
  rememberPost,
  updateInteractionRecord,
  writeCachedFeed,
  writeCachedThread,
} from './api'
import {
  hasPostTag,
  postCategory,
  postDisplayText,
  postFieldValues,
  postTextParts,
  postTags,
} from './tags'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const post = {
  uri: 'at://did:example/app.bsky.feed.post/1',
  cid: 'cid',
  indexedAt: '2026-09-01T00:00:00.000Z',
  author: { did: 'did:example', handle: 'mo.local' },
  record: { text: '真实帖子', createdAt: '2026-09-01T00:00:00.000Z' },
  replyCount: 0,
  repostCount: 0,
  likeCount: 0,
}

const image: PdsImage = { image: { $type: 'blob', ref: { $link: 'bafkreib5testimage' }, mimeType: 'image/png', size: 20 }, alt: '公共客厅' }

describe('post images', () => {
  it('uploads image bytes to the fixed PDS endpoint using the PDS token', async () => {
    const bytes = Buffer.from([137, 80, 78, 71])
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ blob: image.image })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(uploadPdsImage('pds-token', bytes.toString('base64'), 'image/png')).resolves.toEqual(image.image)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/pds/xrpc/com.atproto.repo.uploadBlob')
    expect(init.headers).toEqual({ Authorization: 'Bearer pds-token', 'Content-Type': 'image/png' })
    expect(init.body).toEqual(bytes)
  })

  it('rejects unsupported and oversized uploads before calling PDS', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(uploadPdsImage('pds-token', 'eA==', 'image/svg+xml')).rejects.toThrow('JPG')
    await expect(uploadPdsImage('pds-token', Buffer.alloc(MAX_POST_IMAGE_BYTES + 1).toString('base64'), 'image/png')).rejects.toThrow('1 MB')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces failed image uploads instead of treating them as empty attachments', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '图片上传失败' }), { status: 500 })))
    await expect(uploadPdsImage('pds-token', 'eA==', 'image/png')).rejects.toThrow('图片上传失败')
  })

  it.each([1, 9])('publishes %i images as a gallery and shows them immediately', async (count) => {
    const images = Array.from({ length: count }, (_, index): PdsImage => ({
      image: { ...image.image, ref: { $link: `bafkreiimage${index}` } },
      alt: `图片 ${index + 1}`,
      aspectRatio: { width: 1200, height: 800 },
    }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ uri: post.uri, cid: 'created' })))
    vi.stubGlobal('fetch', fetchMock)
    const created = await createTextPostRecord({ did: 'did:example', accessJwt: 'pds-token', text: '', category: 'post', rkey: 'recordkey', createdAt: post.indexedAt, images })
    const record = JSON.parse(fetchMock.mock.calls[0][1].body).record
    expect(record.embed).toEqual({ $type: 'app.bsky.embed.gallery', items: images.map((item) => ({ $type: 'app.bsky.embed.gallery#image', ...item })) })
    expect(record.text).toBe('')
    const session = { user: { nickname: 'Mo' }, pds: { did: 'did:example', handle: 'mo.local' } } as RiceSession
    const immediate = createdPostView(created, session)
    expect(immediate.record.embed).toEqual(record.embed)
    expect(immediate.images).toHaveLength(count)
    expect(immediate.images?.[count - 1]).toMatchObject({ src: pdsBlobUrl(session.pds.did, images[count - 1].image.ref.$link), width: 1200, height: 800 })
  })

  it('blocks more than nine images, invalid blob sizes, and galleries without real dimensions', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const input = { did: 'did:example', accessJwt: 'pds-token', text: '', category: 'post' as const, rkey: 'recordkey', createdAt: post.indexedAt }
    await expect(createTextPostRecord({ ...input, images: Array(10).fill(image) })).rejects.toThrow('9 张图片')
    await expect(createTextPostRecord({ ...input, images: [image] })).rejects.toThrow('图片尺寸无效')
    await expect(createTextPostRecord({ ...input, images: [{ ...image, aspectRatio: { width: 0, height: 1 } }] })).rejects.toThrow('图片尺寸无效')
    await expect(createTextPostRecord({ ...input, images: [{ ...image, image: { ...image.image, size: MAX_POST_IMAGE_BYTES + 1 } }] })).rejects.toThrow('图片信息无效')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recovers the same gallery after a lost response but rejects changed gallery items', async () => {
    const images = Array.from({ length: 2 }, (_, index): PdsImage => ({ ...image, image: { ...image.image, ref: { $link: `bafkreiimage${index}` } }, aspectRatio: { width: 4, height: 3 } }))
    const input = { did: 'did:example', accessJwt: 'pds-token', text: post.record.text, category: 'post' as const, rkey: 'recordkey', createdAt: post.indexedAt, images }
    const stored = { uri: post.uri, cid: 'stored', value: { text: input.text, createdAt: input.createdAt, xjdaoCategory: input.category, embed: { $type: 'app.bsky.embed.gallery', items: images.map((item) => ({ $type: 'app.bsky.embed.gallery#image', ...item })) } } }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(new Response(JSON.stringify(stored))))
    await expect(createTextPostRecord(input)).resolves.toMatchObject({ uri: post.uri, cid: 'stored' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(new Response(JSON.stringify({ ...stored, value: { ...stored.value, embed: { ...stored.value.embed, items: stored.value.embed.items.map((item, index) => index === 1 ? { ...item, alt: '另一张' } : item) } } }))))
    await expect(createTextPostRecord(input)).rejects.toThrow('上次提交的帖子已发布')
  })

  it('normalizes raw repo embeds for feeds and detail without an arbitrary URL proxy', () => {
    const raw = { ...post, record: { ...post.record, embed: { $type: 'app.bsky.embed.images', images: [image] } } }
    const expected = [{ src: pdsBlobUrl(post.author.did, image.image.ref.$link), alt: image.alt }]
    expect(normalizePostFeed({ posts: [raw] }).posts[0].images).toEqual(expected)
    expect(normalizePostThread({ thread: { post: raw } }).post.images).toEqual(expected)
    expect(normalizePostImages({ ...post, embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'javascript:alert(1)', fullsize: 'data:text/html,test', alt: '' }] } }).images).toBeUndefined()
  })

  it('reads gallery thumbnails and record blobs, showing at most nine images', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      $type: 'app.bsky.embed.gallery#image',
      image: { ...image.image, ref: { $link: `bafkreigallery${index}` } },
      alt: `图片 ${index + 1}`,
      aspectRatio: { width: 4, height: 3 },
    }))
    const views = items.map((item, index) => ({
      $type: 'app.bsky.embed.gallery#viewImage',
      thumbnail: `https://cdn.example/${index}.jpg`,
      fullsize: `https://cdn.example/${index}-full.jpg`,
      alt: item.alt,
      aspectRatio: item.aspectRatio,
    }))
    views[4].thumbnail = 'javascript:alert(1)'
    views[4].fullsize = 'data:text/html,test'
    const record = { ...post.record, embed: { $type: 'app.bsky.embed.gallery', items } }
    const gallery = { ...post, record, embed: { $type: 'app.bsky.embed.gallery#view', items: views } }
    const images = normalizePostFeed({ posts: [gallery] }).posts[0].images
    expect(images).toHaveLength(9)
    expect(images?.[0]).toEqual({ src: 'https://cdn.example/0.jpg', fullsize: 'https://cdn.example/0-full.jpg', alt: '图片 1', width: 4, height: 3 })
    expect(images?.[4]).toEqual({ src: pdsBlobUrl(post.author.did, items[4].image.ref.$link), alt: '图片 5', width: 4, height: 3 })
    expect(images?.[8]?.alt).toBe('图片 9')
    expect(normalizePostThread({ thread: { post: { ...post, record } } }).post.images?.[0]?.src).toBe(pdsBlobUrl(post.author.did, items[0].image.ref.$link))
  })

  it('preserves external image URLs and maps only configured AppView origins to the same-origin gateway', () => {
    vi.stubEnv('XIANGJIAN_APPVIEW_IMAGE_ORIGINS', 'https://internal-appview.example, https://previous-appview.example')
    const viewed = { ...post, record: { ...post.record, embed: { $type: 'app.bsky.embed.images', images: [image] } }, embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.bsky.app/thumb.jpg', fullsize: 'https://cdn.bsky.app/full.jpg', alt: image.alt }] } }
    expect(normalizePostImages(viewed).images).toEqual([{ src: 'https://cdn.bsky.app/thumb.jpg', fullsize: 'https://cdn.bsky.app/full.jpg', alt: image.alt }])
    viewed.embed.images[0].thumb = 'https://internal-appview.example/img/thumb.jpg?format=jpeg'
    viewed.embed.images[0].fullsize = 'https://previous-appview.example/img/full.jpg'
    expect(normalizePostImages(viewed).images).toEqual([{ src: '/bsky/img/thumb.jpg?format=jpeg', fullsize: '/bsky/img/full.jpg', alt: image.alt }])
    // A new deployment's public URLs need no legacy mapping.
    viewed.embed.images[0].thumb = 'https://community.example/bsky/img/thumb.jpg'
    viewed.embed.images[0].fullsize = 'https://community.example/bsky/img/full.jpg'
    expect(normalizePostImages(viewed).images).toEqual([{ src: viewed.embed.images[0].thumb, fullsize: viewed.embed.images[0].fullsize, alt: image.alt }])
  })

  it('does not rewrite lookalike hosts, arbitrary paths, or any origin without deployment configuration', () => {
    const viewed = { ...post, embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://internal-appview.example/img/thumb.jpg', fullsize: 'https://internal-appview.example/img/full.jpg', alt: '' }] } }
    vi.stubEnv('XIANGJIAN_APPVIEW_IMAGE_ORIGINS', '')
    expect(normalizePostImages(viewed).images?.[0].src).toBe(viewed.embed.images[0].thumb)
    vi.stubEnv('XIANGJIAN_APPVIEW_IMAGE_ORIGINS', 'https://internal-appview.example')
    viewed.embed.images[0].thumb = 'https://internal-appview.example.attacker.test/img/thumb.jpg'
    viewed.embed.images[0].fullsize = 'https://internal-appview.example/private/file.jpg'
    expect(normalizePostImages(viewed).images).toEqual([{ src: viewed.embed.images[0].thumb, fullsize: viewed.embed.images[0].fullsize, alt: '' }])
  })
})

describe('feed data', () => {
  it('supplements only the signed-in first page from PDS while indexing lags, then prefers indexed counts', async () => {
    const uri = `at://${post.author.did}/app.bsky.feed.post/new`
    const recent = { uri, cid: 'new-cid', value: { ...post.record, text: '刚刚发布', createdAt: '2026-09-21T12:00:00.000Z' } }
    let indexed = false
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/post/api/posts/list')) return new Response(JSON.stringify({ posts: indexed ? [{ ...post, uri, likeCount: 3 }] : [post] }))
      if (url.includes('collection=app.bsky.feed.post')) return new Response(JSON.stringify({ records: [recent, { ...recent, uri: `${uri}-reply`, value: { ...recent.value, reply: { root: { uri }, parent: { uri } } } }] }))
      if (url.includes('/api/users/')) return new Response(JSON.stringify({ data: { did: post.author.did, handle: 'author.test', nickname: '作者' } }))
      return new Response(JSON.stringify({ records: [], feed: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const input = { did: post.author.did, accessJwt: 'pds-token' }
    const first = await loadPostPage(input)
    expect(first.posts.map(item => item.uri)).toEqual([uri, post.uri])
    expect(first.posts[0].author).toMatchObject({ handle: 'author.test', displayName: '作者' })
    indexed = true
    const second = await loadPostPage(input)
    expect(second.posts.filter(item => item.uri === uri)).toHaveLength(1)
    expect(second.posts[0].likeCount).toBe(3)
    const ownReads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('collection=app.bsky.feed.post'))
    expect(ownReads()).toHaveLength(2)
    expect(String(ownReads()[0][0])).toContain('limit=20')
    expect(String(ownReads()[0][0])).not.toContain('reverse=true')
    await loadPostPage({ ...input, cursor: '2' })
    await loadPostPage({ ...input, repo: 'did:someone-else' })
    await loadPostPage({})
    expect(ownReads()).toHaveLength(2)
  })

  it('keeps legacy hashtag posts and uses the returned list page to continue past empty pages', async () => {
    const legacyPost = { ...post, author: { ...post.author, avatar: 'https://old-appview.example/img/avatar.jpg', displayName: '老用户' }, record: { ...post.record, text: '#活动 以前的活动介绍' } }
    vi.stubEnv('XIANGJIAN_APPVIEW_IMAGE_ORIGINS', 'https://old-appview.example')
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => String(url).includes('/post/api/posts/list')
      ? new Response(JSON.stringify({ posts: [legacyPost], page: 3, total: 81 }))
      : new Response(JSON.stringify({ data: { did: post.author.did, nickname: null, avatar: null } })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await loadPostPage({ cursor: '2', category: 'post' })
    expect(result.cursor).toBe('4')
    expect(result.posts[0]).toMatchObject({ author: { displayName: '老用户', avatar: '/bsky/img/avatar.jpg' }, record: legacyPost.record })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ page: 2, per_page: 20 })
  })

  it('ends list pagination at the last returned page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).includes('/post/api/posts/list')
      ? new Response(JSON.stringify({ posts: [], page: 2, total: 40 }))
      : new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })))
    await expect(loadPostPage({ cursor: '2' })).resolves.toEqual({ posts: [], cursor: null })
  })

  it('loads a public thread for guests without bearer headers or private viewer record reads', async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => String(input).includes('getPostThread')
      ? new Response(JSON.stringify({ thread: { post, replies: [] } }))
      : new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadPostThread({ uri: post.uri })).resolves.toEqual({ post, replies: [] })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/bsky/xrpc/app.bsky.feed.getPostThread?')
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('listRecords'))).toBe(false)
  })

  it('keeps a fetched thread for the same account and clears it with the feed', () => {
    vi.stubGlobal('window', {})
    const root = { ...post, uri: `${post.uri}-cached` }
    const reply = { ...post, uri: `${post.uri}-cached-reply` }
    const child = { ...post, uri: `${post.uri}-cached-child` }
    const thread = { post: root, replies: [{ post: reply, parentUri: root.uri }, { post: child, parentUri: reply.uri }] }
    writeCachedThread(thread, 'did:example')
    expect(readCachedThread(root.uri, 'did:example')).toBe(thread)
    expect(readCachedThread(root.uri, 'did:other')).toBeNull()
    clearCachedFeed('did:example')
    expect(readCachedThread(root.uri, 'did:example')).toBeNull()
  })

  it.each([undefined, '真实帖子'])('uses local author names in list/search and preserves external authors (query=%s)', async (query) => {
    const external = { ...post, uri: `${post.uri}-external`, author: { did: 'did:external', handle: 'outside.test', displayName: '外部作者' } }
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/post/api/posts/')) return new Response(JSON.stringify({ posts: [post, { ...post, uri: `${post.uri}-second` }, external] }))
      if (url.includes('/api/users/did%3Aexample/profile')) return new Response(JSON.stringify({ data: { did: post.author.did, nickname: '测试参与者 B' } }))
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const page = await loadPostPage({ query })
    expect(page.posts.filter((item) => item.author.did === post.author.did).map((item) => item.author.displayName)).toEqual(['测试参与者 B', '测试参与者 B'])
    expect(page.posts.find((item) => item.author.did === 'did:external')?.author).toEqual(external.author)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/users/'))).toHaveLength(2)
    expect(page.posts[0].record).toEqual(post.record)
  })

  it('uses the same local name for thread author and replies with one profile read per DID', async () => {
    const localReply = { ...post, uri: `${post.uri}-reply` }
    const nestedReply = { ...post, uri: `${post.uri}-nested` }
    const externalReply = { ...post, uri: `${post.uri}-external`, author: { did: 'did:external', handle: 'outside.test', displayName: '外部作者' } }
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('getPostThread')) return new Response(JSON.stringify({ thread: { post, replies: [{ post: localReply, replies: [{ post: nestedReply }] }, { post: externalReply }] } }))
      if (url.includes('listRecords')) return new Response(JSON.stringify({ records: [] }))
      if (url.includes('/api/users/did%3Aexample/profile')) return new Response(JSON.stringify({ data: { did: post.author.did, nickname: '测试参与者 B' } }))
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const thread = await loadPostThread({ uri: post.uri, did: 'did:viewer', accessJwt: 'pds-token' })
    expect(thread.post.author.displayName).toBe('测试参与者 B')
    expect(thread.replies[0].post.author.displayName).toBe('测试参与者 B')
    expect(thread.replies[1]).toMatchObject({ parentUri: localReply.uri, post: { author: { displayName: '测试参与者 B' } } })
    expect(thread.replies[2].post.author).toEqual(externalReply.author)
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('depth')).toBe('2')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/users/'))).toHaveLength(2)
  })

  it('reuses the post key when a successful publish response was lost', async () => {
    const rkey = newPostRecordKey()
    expect(rkey).toMatch(/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/)
    expect(newPostRecordKey() > rkey).toBe(true)
    const input = { did: 'did:alice', accessJwt: 'pds-token', text: '一起种花 #社区', category: 'post' as const, rkey, createdAt: '2026-09-15T01:00:00.000Z' }
    const uri = `at://${input.did}/app.bsky.feed.post/${rkey}`
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(new Response(JSON.stringify({ uri, cid: 'stored-cid', value: { text: input.text, createdAt: input.createdAt, xjdaoCategory: 'post' } })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createTextPostRecord(input)).resolves.toMatchObject({ uri, cid: 'stored-cid' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rkey).toBe(rkey)
    expect(String(fetchMock.mock.calls[1][0])).toContain(`rkey=${rkey}`)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer pds-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replace an already published post with a changed retry payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('already exists')).mockResolvedValueOnce(new Response(JSON.stringify({ value: { text: '已发布内容', createdAt: '2026-09-15T01:00:00.000Z', xjdaoCategory: 'post' } }))))
    await expect(createTextPostRecord({ did: 'did:alice', accessJwt: 'pds-token', text: '编辑后的内容', category: 'post', rkey: newPostRecordKey(), createdAt: '2026-09-15T01:00:00.000Z' })).rejects.toThrow('上次提交的帖子已发布')
  })

  it('keeps category independent from exact searchable tags', () => {
    const text = '赶集信息\n#乡村 #商品 #活动'
    const productRecord = { ...post.record, text, xjdaoCategory: 'product' as const }

    expect(postTags(text)).toEqual(['#乡村', '#商品', '#活动'])
    expect(postCategory(productRecord)).toBe('product')
    expect(postCategory({ ...post.record, text })).toBe('post')
    expect(hasPostTag('#活动周', '活动')).toBe(false)
    expect(postTextParts('开放日 #活动').filter((part) => part.isTag)).toEqual([
      { value: '#活动', isTag: true },
    ])
  })

  it('reads existing special post fields for rendering', () => {
    const text = '古村开放日 #乡村\n截止时间：2026-09-10T18:00\n活动地点：漈下村村委\n参与条件：自带水杯'
    expect(postFieldValues(text, 'activity')).toEqual({
      deadline: '2026-09-10T18:00',
      location: '漈下村村委',
      conditions: '自带水杯',
    })
    expect(postDisplayText(text, 'activity')).toBe('古村开放日 #乡村')

    const product = '秋收新米\n参考稻米：88\n可用状态：可提供\n履约说明：村口自提'
    expect(postFieldValues(product, 'product')).toEqual({
      price: '88',
      availability: '可提供',
      fulfillment: '村口自提',
    })
    expect(postDisplayText(product, 'product')).toBe('秋收新米')
  })

  it('filters direct posts and repost events by category rather than tag', async () => {
    const activityPost = {
      ...post,
      uri: `${post.uri}-activity`,
      record: { ...post.record, text: '开放日\n#商品 #乡村', xjdaoCategory: 'activity' as const },
    }
    const taggedPlainPost = {
      ...post,
      record: { ...post.record, text: '普通讨论\n#活动' },
    }
    const reason = {
      $type: 'app.bsky.feed.defs#reasonRepost' as const,
      by: { did: 'did:viewer', handle: 'viewer.local' },
      uri: 'at://did:viewer/app.bsky.feed.repost/1',
      indexedAt: '2026-09-01T01:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [activityPost, taggedPlainPost] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            feed: [
              { post: taggedPlainPost, reason: { ...reason, uri: `${reason.uri}-plain` } },
              { post: activityPost, reason },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const feed = await loadPostPage({ category: 'activity', accessJwt: 'access-token' })

    expect(feed.posts).toHaveLength(2)
    expect(feed.posts.every((item) => postCategory(item.record) === 'activity')).toBe(true)
  })

  it('reuses one account feed until that account writes', () => {
    vi.stubGlobal('window', {})
    const feed = { posts: [post] }

    writeCachedFeed(feed, 'did:alice')
    expect(readCachedFeed('did:alice')).toBe(feed)
    expect(readCachedFeed('did:bob')).toBeNull()

    clearCachedFeed('did:bob')
    expect(readCachedFeed('did:alice')).toBe(feed)
    clearCachedFeed('did:alice')
    expect(readCachedFeed('did:alice')).toBeNull()
  })

  it('shows the selected post immediately only for the same account', () => {
    vi.stubGlobal('window', {})
    const selected = { ...post, uri: `${post.uri}-selected` }
    rememberPost(selected, 'did:alice')

    expect(readRememberedPost(selected.uri, 'did:alice')).toBe(selected)
    expect(readRememberedPost(selected.uri, 'did:bob')).toBeNull()
    expect(readRememberedPost(post.uri, 'did:alice')).toBeNull()

    hideDeletedPost(selected.uri, 'did:alice')
    expect(readRememberedPost(selected.uri, 'did:alice')).toBeNull()
  })

  it('shows a newly created post from cache without waiting for indexing', () => {
    vi.stubGlobal('window', {})
    const created = { ...post, uri: `${post.uri}-new` }

    writeCachedFeed({ posts: [post] }, 'did:alice')
    prependCachedPost(created, 'did:alice')

    expect(readCachedFeed('did:alice')?.posts).toEqual([created, post])
    clearCachedFeed('did:alice')
    prependCachedPost(created, 'did:alice')
    expect(readCachedFeed('did:alice')).toEqual({ posts: [created], cursor: '1' })
    expect(readCachedFeed('did:bob')).toBeNull()
  })

  it('keeps a deleted post out of the current client feed while indexing catches up', () => {
    vi.stubGlobal('window', {})
    writeCachedFeed({ posts: [post] }, 'did:example')

    hideDeletedPost(post.uri, 'did:example')

    expect(isPostHidden(post.uri)).toBe(true)
    expect(readCachedFeed('did:example')?.posts).toEqual([])
  })

  it('builds the same optimistic view for posts and replies', () => {
    const session = {
      user: { nickname: 'Mo Alice' },
      pds: { did: 'did:alice', handle: 'alice.local' },
    } as RiceSession
    const subject = { uri: post.uri, cid: post.cid }
    const reply = { root: subject, parent: subject }

    expect(createdPostView(
      { ...post, text: post.record.text, createdAt: post.indexedAt },
      session,
      reply,
    ))
      .toMatchObject({ author: { did: 'did:alice' }, record: { reply } })
  })

  it('accepts both feed wrappers and direct search results', () => {
    expect(normalizePostFeed({ posts: [{ post }], total: 1 })).toEqual({
      posts: [post],
    })
    expect(normalizePostFeed({ posts: [post] })).toEqual({
      posts: [post],
    })
  })

  it('preserves the post search cursor and requested page size', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ posts: [post], cursor: 'next-post-page' }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const page = await loadPostPage({
      query: '古村',
      cursor: 'current-post-page',
      limit: 10,
    })

    expect(page).toEqual({ posts: [post], cursor: 'next-post-page' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      q: '古村',
      limit: 10,
      sort: 'latest',
      cursor: 'current-post-page',
    })
  })

  it('keeps replies out of top-level feeds and preserves repost reasons', () => {
    const reply = {
      ...post,
      uri: 'at://did:example/app.bsky.feed.post/reply',
      record: {
        ...post.record,
        reply: {
          root: { uri: post.uri, cid: post.cid },
          parent: { uri: post.uri, cid: post.cid },
        },
      },
    }
    const reason = {
      $type: 'app.bsky.feed.defs#reasonRepost' as const,
      by: { did: 'did:viewer', handle: 'viewer.local' },
      uri: 'at://did:viewer/app.bsky.feed.repost/1',
      indexedAt: '2026-09-01T01:00:00.000Z',
    }

    expect(
      normalizePostFeed({
        posts: [
          { post: reply, reply: { parent: post } },
          { post, reason },
        ],
      }),
    ).toEqual({ posts: [{ ...post, reason }] })
  })

  it('keeps comments and their replies attached to the correct parent', () => {
    const reply = { ...post, uri: `${post.uri}-reply` }
    const child = { ...post, uri: `${post.uri}-child`, record: { ...post.record, text: '回复评论' } }
    expect(normalizePostThread({
      thread: {
        post,
        replies: [{ post: reply, replies: [{ post: child }, { blocked: true }] }, { blocked: true }],
      },
    })).toEqual({
      post,
      replies: [{ post: reply, parentUri: post.uri }, { post: child, parentUri: reply.uri }],
    })
  })

  it('extracts the record key used to undo an interaction', () => {
    expect(
      recordKeyFromUri(
        'at://did:example/app.bsky.feed.like/3abc',
        'app.bsky.feed.like',
      ),
    ).toBe('3abc')
  })

  it('keeps guest posts readable but reports an expired signed-in PDS token', async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      if (String(input).includes('/post/api/posts/list')) {
        return new Response(JSON.stringify({ posts: [post] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ error: 'ExpiredToken', message: 'Token has expired' }),
        { status: 400 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const guestFeed = await loadPostPage({})
    await expect(loadPostPage({
      did: 'did:example',
      accessJwt: 'expired-access',
    })).rejects.toThrow('登录状态已过期')
    const [, postCacheInit] = fetchMock.mock.calls[0]

    expect(guestFeed.posts).toEqual([post])
    expect(postCacheInit?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('returns the record URI needed to toggle likes and reposts', async () => {
    const recordUri = 'at://did:example/app.bsky.feed.like/3abc'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uri: recordUri, cid: 'interaction-cid' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const input = {
      did: 'did:example',
      accessJwt: 'access-token',
      postUri: post.uri,
      postCid: post.cid,
    }

    await expect(
      updateInteractionRecord(input, 'app.bsky.feed.like'),
    ).resolves.toMatchObject({ recordUri })
    await expect(
      updateInteractionRecord(
        { ...input, recordUri },
        'app.bsky.feed.like',
      ),
    ).resolves.toEqual({ recordUri: null, indexedAt: null })

    const deleteBody = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ) as Record<string, string>
    expect(deleteBody).toMatchObject({
      repo: input.did,
      collection: 'app.bsky.feed.like',
      rkey: '3abc',
    })
  })

  it('deletes only a post from the signed-in repository', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteOwnPostRecord({
      did: post.author.did,
      accessJwt: 'access-token',
      uri: post.uri,
    })).resolves.toEqual({ uri: post.uri })

    const deleteBody = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as Record<string, string>
    expect(deleteBody).toEqual({
      repo: post.author.did,
      collection: 'app.bsky.feed.post',
      rkey: '1',
    })

    await expect(deleteOwnPostRecord({
      did: 'did:someone-else',
      accessJwt: 'access-token',
      uri: post.uri,
    })).rejects.toThrow('只能删除自己的帖子')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('viewer interaction isolation', () => {
  const alice = 'did:alice'
  const bob = 'did:bob'
  const liked = {
    ...post,
    likeCount: 1,
    repostCount: 1,
    viewer: {
      like: `at://${alice}/app.bsky.feed.like/same-key`,
      repost: `at://${alice}/app.bsky.feed.repost/same-key`,
    },
  }
  const response = (value: unknown) => new Response(JSON.stringify(value))

  it.each([
    ['plaza', {}],
    ['search', { query: '真实帖子' }],
    ['profile posts', { repo: post.author.did }],
  ] as const)('rebuilds %s interactions for A, B and guests from the same cached post', async (_name, filters) => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/post/api/posts/')) return response({ posts: [liked] })
      if (url.pathname.endsWith('listRecords')) {
        const collection = url.searchParams.get('collection')!
        return response({ records: url.searchParams.get('repo') === alice
          ? [{ uri: `at://${alice}/${collection}/same-key`, value: { subject: { uri: post.uri } } }]
          : [] })
      }
      return response({ feed: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const a = await loadPostPage({ ...filters, did: alice, accessJwt: 'alice-token' })
    const b = await loadPostPage({ ...filters, did: bob, accessJwt: 'bob-token' })
    const guest = await loadPostPage(filters)
    expect(a.posts[0].viewer).toEqual(liked.viewer)
    expect(b.posts[0].viewer).toBeUndefined()
    expect(guest.posts[0].viewer).toBeUndefined()
    expect([a, b, guest].map((feed) => [feed.posts[0].likeCount, feed.posts[0].repostCount])).toEqual([[1, 1], [1, 1], [1, 1]])
    expect(liked.viewer.like).toContain(alice)
    for (const [input, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      const url = new URL(input)
      if (url.pathname.endsWith('listRecords')) {
        expect(init.headers).toEqual({ Authorization: `Bearer ${url.searchParams.get('repo') === alice ? 'alice' : 'bob'}-token` })
      }
    }
  })

  it('never preserves another account viewer when private hydration fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/post/api/posts/')) return response({ posts: [liked] })
      if (url.includes('listRecords')) return new Response(JSON.stringify({ message: 'PDS unavailable' }), { status: 503 })
      return response({ feed: [] })
    }))
    const feed = await loadPostPage({ did: bob, accessJwt: 'bob-token' })
    expect(feed.posts[0].viewer).toBeUndefined()
    expect(feed.posts[0].likeCount).toBe(1)
  })

  it('hydrates thread replies as well as the root and strips all guest viewer records', async () => {
    const reply = { ...liked, uri: `${post.uri}-reply` }
    const bobLike = `at://${bob}/app.bsky.feed.like/reply-like`
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('getPostThread')) return response({ thread: { post: liked, replies: [{ post: reply }] } })
      if (url.pathname.endsWith('listRecords')) return response({ records: url.searchParams.get('collection') === 'app.bsky.feed.like'
        ? [{ uri: bobLike, value: { subject: { uri: reply.uri } } }]
        : [] })
      return response({})
    }))
    const thread = await loadPostThread({ uri: post.uri, did: bob, accessJwt: 'bob-token' })
    expect(thread.post.viewer).toBeUndefined()
    expect(thread.replies[0].post.viewer).toEqual({ like: bobLike })
    const guest = await loadPostThread({ uri: post.uri })
    expect(guest.post.viewer).toBeUndefined()
    expect(guest.replies[0].post.viewer).toBeUndefined()
  })

  it('reads subsequent interaction pages and ignores records from a different repository or collection', async () => {
    const bobLike = `at://${bob}/app.bsky.feed.like/older`
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/post/api/posts/')) return response({ posts: [liked] })
      if (!url.pathname.endsWith('listRecords')) return response({ feed: [] })
      if (url.searchParams.get('collection') === 'app.bsky.feed.repost') return response({ records: [] })
      if (!url.searchParams.has('cursor')) return response({ records: [
        { uri: liked.viewer.like, value: { subject: { uri: post.uri } } },
        { uri: `at://${bob}/app.bsky.feed.repost/wrong-collection`, value: { subject: { uri: post.uri } } },
      ], cursor: 'older-page' })
      return response({ records: [{ uri: bobLike, value: { subject: { uri: post.uri } } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const feed = await loadPostPage({ did: bob, accessJwt: 'bob-token' })
    expect(feed.posts[0].viewer).toEqual({ like: bobLike })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('cursor=older-page'))).toBe(true)
  })

  it.each(['app.bsky.feed.like', 'app.bsky.feed.repost'] as const)('rejects cancelling a foreign %s URI before contacting PDS', async (collection) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(updateInteractionRecord({ did: bob, accessJwt: 'bob-token', postUri: post.uri, postCid: post.cid, recordUri: `at://${alice}/${collection}/same-key` }, collection)).rejects.toThrow('只能取消当前账号')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
