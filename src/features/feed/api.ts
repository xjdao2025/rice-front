import { createServerFn } from '@tanstack/react-start'

import { BACKEND_BASE, isSessionAuthError, requestJson } from '~/lib/http'
import type { PdsImage, PostCategory, PostFeed, PostImage, PostThread, PostView, RicePublicUser, RiceSession } from '~/lib/models'
import { appviewImageUrl, createPdsRecord, deletePdsRecord, MAX_POST_IMAGE_BYTES, MAX_POST_IMAGES, MAX_POST_TEXT_LENGTH, pdsBlobUrl, POST_IMAGE_TYPES, recordKeyFromUri, uploadPdsImage } from '~/lib/pds'

import { hasPostTag, postCategory } from './tags'

let clientFeedCache: { owner: string | null; feed: PostFeed } | null = null
let clientSelectedPost: { owner: string | null; post: PostView } | null = null
const clientDeletedPostUris = new Set<string>()
const clientThreadCache = new Map<string, { thread: PostThread; savedAt: number }>()
const THREAD_CACHE_TTL_MS = 30_000
const MAX_CACHED_THREADS = 25
const FEED_PAGE_SIZE = 20
const threadCacheKey = (uri: string, did?: string) => `${did ?? ''}\0${uri}`

export function readCachedThread(uri: string, did?: string) {
  if (typeof window === 'undefined' || clientDeletedPostUris.has(uri)) return null
  const key = threadCacheKey(uri, did)
  const cached = clientThreadCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.savedAt < THREAD_CACHE_TTL_MS) return cached.thread
  clientThreadCache.delete(key)
  return null
}

export function writeCachedThread(thread: PostThread, did?: string) {
  if (typeof window === 'undefined') return
  const key = threadCacheKey(thread.post.uri, did)
  clientThreadCache.delete(key)
  clientThreadCache.set(key, { thread, savedAt: Date.now() })
  if (clientThreadCache.size > MAX_CACHED_THREADS) clientThreadCache.delete(clientThreadCache.keys().next().value!)
}

export function readCachedFeed(did?: string) {
  if (typeof window === 'undefined') return null
  return clientFeedCache?.owner === (did ?? null) ? clientFeedCache.feed : null
}

export function writeCachedFeed(feed: PostFeed, did?: string) {
  if (typeof window === 'undefined') return
  clientFeedCache = { owner: did ?? null, feed }
}

export function rememberPost(post: PostView, did?: string) {
  if (typeof window === 'undefined') return
  clientSelectedPost = { owner: did ?? null, post }
}

export function readRememberedPost(uri: string, did?: string) {
  if (typeof window === 'undefined' || clientDeletedPostUris.has(uri)) return null
  const owner = did ?? null
  if (clientSelectedPost?.owner === owner && clientSelectedPost.post.uri === uri) return clientSelectedPost.post
  return clientFeedCache?.owner === owner
    ? clientFeedCache.feed.posts.find((post) => post.uri === uri) ?? null
    : null
}

export function prependCachedPost(post: PostView, did?: string) {
  if (typeof window === 'undefined') return
  if (clientFeedCache?.owner !== (did ?? null)) {
    // Publishing from another page must not depend on having opened the plaza.
    clientFeedCache = { owner: did ?? null, feed: { posts: [post], cursor: '1' } }
    return
  }

  const posts = [post, ...clientFeedCache.feed.posts.filter((item) => item.uri !== post.uri)]
  clientFeedCache = {
    owner: did ?? null,
    feed: { ...clientFeedCache.feed, posts },
  }
}

export function hideDeletedPost(uri: string, did?: string) {
  if (typeof window === 'undefined') return
  clientDeletedPostUris.add(uri)
  for (const key of clientThreadCache.keys()) {
    if (key.endsWith(`\0${uri}`)) clientThreadCache.delete(key)
  }
  if (clientSelectedPost?.post.uri === uri) clientSelectedPost = null

  if (clientFeedCache?.owner === (did ?? null)) {
    clientFeedCache = {
      owner: did ?? null,
      feed: {
        ...clientFeedCache.feed,
        posts: clientFeedCache.feed.posts.filter((post) => post.uri !== uri),
      },
    }
  }
}

export function isPostHidden(uri: string) {
  return typeof window !== 'undefined' && clientDeletedPostUris.has(uri)
}

export function clearCachedFeed(did?: string) {
  for (const key of clientThreadCache.keys()) {
    if (key.startsWith(`${did ?? ''}\0`)) clientThreadCache.delete(key)
  }
  if (
    typeof window !== 'undefined' &&
    clientFeedCache?.owner === (did ?? null)
  ) {
    clientFeedCache = null
  }
}

function postImageEmbed(images: PdsImage[]) {
  return { $type: 'app.bsky.embed.gallery', items: images.map(({ image, alt, aspectRatio }) => ({ $type: 'app.bsky.embed.gallery#image' as const, image, alt, aspectRatio })) }
}

export function createdPostView(
  created: {
    uri: string
    cid: string
    text: string
    createdAt: string
    category?: PostCategory
    images?: PdsImage[]
  },
  session: RiceSession,
  reply?: PostView['record']['reply'],
): PostView {
  return {
    uri: created.uri,
    cid: created.cid,
    indexedAt: created.createdAt,
    author: {
      did: session.pds.did,
      handle: session.pds.handle,
      displayName: session.user.nickname ?? undefined,
      ...(session.user.avatar?.url ? { avatar: session.user.avatar.url } : {}),
    },
    record: {
      text: created.text,
      createdAt: created.createdAt,
      ...(created.category ? { xjdaoCategory: created.category } : {}),
      ...(reply ? { reply } : {}),
      ...(created.images?.length ? { embed: postImageEmbed(created.images) } : {}),
    },
    ...(created.images?.length ? { images: created.images.map((item) => ({ src: pdsBlobUrl(session.pds.did, item.image.ref.$link), alt: item.alt, ...item.aspectRatio })) } : {}),
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
  }
}

type InteractionCollection = 'app.bsky.feed.like' | 'app.bsky.feed.repost'

export function ownedInteractionUri(uri: string | undefined, did: string, collection: InteractionCollection) {
  const prefix = `at://${did}/${collection}/`
  if (typeof uri !== 'string' || !uri.startsWith(prefix)) return undefined
  const key = uri.slice(prefix.length)
  return /^[a-zA-Z0-9._~:-]+$/.test(key) && key !== '.' && key !== '..' ? uri : undefined
}

async function hydrateViewerRecords(
  posts: PostView[],
  did?: string,
  accessJwt?: string,
) {
  // Post Cache is shared. Its viewer belongs to whoever populated it, not this reader.
  const publicPosts = posts.map(({ viewer: _viewer, ...post }) => post)
  if (!did || !accessJwt || posts.length === 0) return publicPosts

  const subjects = new Set(posts.map((post) => post.uri))
  const list = async (collection: InteractionCollection) => {
    // ponytail: Scan the reader's records; use authenticated AppView lookups if histories become large.
    const found = new Map<string, string>()
    let cursor: string | undefined
    do {
      const params = new URLSearchParams({ repo: did, collection, limit: '100' })
      if (cursor) params.set('cursor', cursor)
      const body = await requestJson<{
        records?: Array<{ uri: string; value?: { subject?: { uri?: string } } }>
        cursor?: string
      }>(
        `${BACKEND_BASE}/pds/xrpc/com.atproto.repo.listRecords?${params}`,
        { headers: { Authorization: `Bearer ${accessJwt}` } },
      )
      for (const record of body.records ?? []) {
        const subject = record.value?.subject?.uri
        const uri = ownedInteractionUri(record.uri, did, collection)
        if (subject && subjects.has(subject) && uri) found.set(subject, uri)
      }
      if (found.size === subjects.size || body.cursor === cursor) break
      cursor = body.cursor
    } while (cursor)
    return found
  }

  try {
    const [likes, reposts] = await Promise.all([
      list('app.bsky.feed.like'),
      list('app.bsky.feed.repost'),
    ])
    return publicPosts.map((post) => {
      const like = likes.get(post.uri)
      const repost = reposts.get(post.uri)
      return like || repost ? { ...post, viewer: { ...(like ? { like } : {}), ...(repost ? { repost } : {}) } } : post
    })
  } catch (error) {
    if (isSessionAuthError(error)) throw error
    return publicPosts
  }
}

async function hydrateAuthorNames(posts: PostView[]) {
  const authors = posts.flatMap((post) => post.reason ? [post.author, post.reason.by] : [post.author])
  const profiles = new Map<string, RicePublicUser>()
  await Promise.all([...new Set(authors.map((author) => author.did))].map(async (did) => {
    const profile = await requestJson<{ data: RicePublicUser }>(`${BACKEND_BASE}/api/users/${encodeURIComponent(did)}/profile`).catch(() => null)
    if (profile?.data?.did === did) profiles.set(did, profile.data)
  }))
  const authorName = (author: PostView['author']) => {
    const profile = profiles.get(author.did)
    const avatar = profile?.avatar?.url || author.avatar
    return { ...author, ...(profile?.handle ? { handle: profile.handle } : {}), ...(profile?.nickname ? { displayName: profile.nickname } : {}), ...(avatar ? { avatar: appviewImageUrl(avatar) } : {}) }
  }
  return posts.map((post) => ({
    ...post,
    author: authorName(post.author),
    ...(post.reason ? { reason: { ...post.reason, by: authorName(post.reason.by) } } : {}),
  }))
}

export function normalizePostImages(post: PostView): PostView {
  const imageEmbed = (value: unknown) => {
    const embed = value as { $type?: string; images?: unknown[]; items?: unknown[]; media?: unknown } | undefined
    if (embed?.$type === 'app.bsky.embed.recordWithMedia#view' || embed?.$type === 'app.bsky.embed.recordWithMedia') return embed.media as typeof embed
    return embed
  }
  const view = imageEmbed(post.embed)
  const record = imageEmbed(post.record.embed)
  const imageItems = (embed: typeof view) => embed?.$type === 'app.bsky.embed.gallery' || embed?.$type === 'app.bsky.embed.gallery#view' ? embed.items : embed?.images
  const viewed = imageItems(view)
  const originals = imageItems(record)
  const source = Array.isArray(viewed) && viewed.length ? viewed : originals
  if (!Array.isArray(source) || !source.length) return post
  const images = source.slice(0, MAX_POST_IMAGES).flatMap((value, index): PostImage[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as { thumb?: unknown; thumbnail?: unknown; fullsize?: unknown; alt?: unknown; image?: { ref?: { $link?: unknown }; cid?: unknown }; aspectRatio?: { width?: number; height?: number } }
    const httpUrl = (url: unknown) => typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined
    const original = originals?.[index] as typeof item | undefined
    const cid = item.image?.ref?.$link ?? item.image?.cid ?? original?.image?.ref?.$link ?? original?.image?.cid
    const blobUrl = typeof cid === 'string' && /^[a-z0-9]+$/i.test(cid) ? pdsBlobUrl(post.author.did, cid) : undefined
    const viewUrl = (value: unknown) => {
      const url = httpUrl(value)
      if (!url) return undefined
      return appviewImageUrl(url)
    }
    const fullsize = viewUrl(item.fullsize)
    const src = viewUrl(item.thumb) ?? viewUrl(item.thumbnail) ?? fullsize ?? blobUrl
    if (!src) return []
    return [{ src, ...(fullsize ? { fullsize } : {}), alt: typeof item.alt === 'string' ? item.alt : '', ...item.aspectRatio }]
  })
  return images.length ? { ...post, images } : post
}

export function normalizePostFeed(payload: unknown): PostFeed {
  const body = (payload ?? {}) as {
    posts?: Array<
      PostView | {
        post?: PostView
        reply?: unknown
        reason?: PostView['reason']
      }
    >
  }
  const posts = (body.posts ?? [])
    .map((item): PostView | undefined => {
      if (!('post' in item)) return item as PostView
      if (!item.post || item.reply) return undefined
      return item.reason ? { ...item.post, reason: item.reason } : item.post
    })
    .filter((post): post is PostView =>
      Boolean(
        post?.uri &&
        post.record?.text !== undefined &&
        !post.record.reply,
      ),
    )
    .map(normalizePostImages)

  return { posts }
}

async function loadTimelineReposts(accessJwt?: string) {
  if (!accessJwt) return []
  try {
    const payload = await requestJson<{ feed?: unknown[] }>(
      `${BACKEND_BASE}/pds/xrpc/app.bsky.feed.getTimeline?limit=50`,
      { headers: { Authorization: `Bearer ${accessJwt}` } },
    )
    return normalizePostFeed({ posts: payload.feed }).posts.filter(
      (post) => post.reason?.$type === 'app.bsky.feed.defs#reasonRepost',
    )
  } catch (error) {
    if (isSessionAuthError(error)) throw error
    return []
  }
}

async function loadOwnRecentPosts(did: string, accessJwt: string) {
  // Read-your-writes: the PDS has committed before the shared index/AppView catches up.
  const params = new URLSearchParams({ repo: did, collection: 'app.bsky.feed.post', limit: String(FEED_PAGE_SIZE) })
  const payload = await requestJson<{ records?: Array<{ uri: string; cid: string; value: PostView['record'] }> }>(
    `${BACKEND_BASE}/pds/xrpc/com.atproto.repo.listRecords?${params}`,
    { headers: { Authorization: `Bearer ${accessJwt}` } },
  ).catch((error) => {
    if (isSessionAuthError(error)) throw error
    return null
  })
  return normalizePostFeed({ posts: (payload?.records ?? []).map(record => ({
    uri: record.uri, cid: record.cid, record: record.value, indexedAt: record.value.createdAt,
    author: { did, handle: did }, replyCount: 0, repostCount: 0, likeCount: 0,
  })) }).posts
}

function mergeFeedPosts(posts: PostView[], reposts: PostView[]) {
  const seenReposts = new Set<string>()
  return [...posts, ...reposts]
    .filter((post) => {
      if (!post.reason) return true
      const key = post.reason.uri ?? `${post.reason.by.did}:${post.uri}`
      if (seenReposts.has(key)) return false
      seenReposts.add(key)
      return true
    })
    .sort((a, b) =>
      (b.reason?.indexedAt ?? b.indexedAt).localeCompare(
        a.reason?.indexedAt ?? a.indexedAt,
      ),
    )
}

export function normalizePostThread(payload: unknown): PostThread {
  const body = payload as { thread?: { post?: PostView; replies?: unknown[] } }
  const post = body.thread?.post
  if (!post?.uri || post.record?.text === undefined) {
    throw new Error('帖子暂时无法显示')
  }

  const replies = (body.thread?.replies ?? [])
    .flatMap((value) => {
      const node = value as { post?: PostView; replies?: unknown[] }
      const parent = node.post
      if (!parent?.uri || parent.record?.text === undefined) return []
      const children = (node.replies ?? [])
        .map((child) => (child as { post?: PostView }).post)
        .filter((child): child is PostView => Boolean(child?.uri && child.record?.text !== undefined))
        .map((child) => ({ post: normalizePostImages(child), parentUri: parent.uri }))
      return [{ post: normalizePostImages(parent), parentUri: post.uri }, ...children]
    })
  return { post: normalizePostImages(post), replies }
}

export type GetPostsInput = {
  query?: string
  repo?: string
  tag?: string
  category?: PostCategory
  cursor?: string
  limit?: number
  accessJwt?: string
  did?: string
}

export async function loadPostPage(data: GetPostsInput) {
  const query = data.query?.trim()
  const page = !query && data.cursor ? Number(data.cursor) : 1
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('帖子页码无效')
  const endpoint = query ? '/post/api/posts/search' : '/post/api/posts/list'
  const requestBody = query
    ? {
        q: query,
        limit: data.limit ?? 25,
        sort: 'latest',
        ...(data.cursor ? { cursor: data.cursor } : {}),
      }
    : {
        page,
        per_page: data.limit ?? FEED_PAGE_SIZE,
        ...(data.repo ? { repo: data.repo } : {}),
        ...(data.tag ? { tag: data.tag } : {}),
      }
  const payload = await requestJson<unknown>(`${BACKEND_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  const feed = normalizePostFeed(payload)
  const [timelineReposts, ownPosts] = await Promise.all([
    !query && !data.repo && page === 1 ? loadTimelineReposts(data.accessJwt) : [],
    !query && page === 1 && data.did && data.accessJwt && (!data.repo || data.repo === data.did)
      ? loadOwnRecentPosts(data.did, data.accessJwt) : [],
  ])
  const indexedUris = new Set(feed.posts.map(post => post.uri))
  const posts = mergeFeedPosts([...feed.posts, ...ownPosts.filter(post => !indexedUris.has(post.uri))], timelineReposts).filter(
    (post) =>
      (!data.tag || hasPostTag(post.record.text, data.tag)) &&
      (!data.category || postCategory(post.record) === data.category),
  )
  const body = payload as { cursor?: unknown; page?: number; total?: number }
  const currentPage = body.page ?? page
  return {
    posts: await hydrateAuthorNames(await hydrateViewerRecords(posts, data.did, data.accessJwt)),
    cursor: query
      ? typeof body.cursor === 'string' && body.cursor ? body.cursor : null
      : currentPage * (data.limit ?? FEED_PAGE_SIZE) < (body.total ?? 0) ? String(currentPage + 1) : null,
  }
}

export const getPosts = createServerFn({ method: 'POST' })
  .validator((data: GetPostsInput) => data)
  .handler(({ data }) => loadPostPage(data))

type PostThreadInput = { uri: string; accessJwt?: string; did?: string }
export async function loadPostThread(data: PostThreadInput): Promise<PostThread> {
    const params = new URLSearchParams({
      uri: data.uri,
      depth: '2',
      parentHeight: '0',
    })
    const payload = await requestJson<unknown>(
      `${BACKEND_BASE}/${data.accessJwt ? 'pds' : 'bsky'}/xrpc/app.bsky.feed.getPostThread?${params}`,
      data.accessJwt ? { headers: { Authorization: `Bearer ${data.accessJwt}` } } : undefined,
    )
    const thread = normalizePostThread(payload)
    const posts = await hydrateViewerRecords(
      [thread.post, ...thread.replies.map((reply) => reply.post)],
      data.did,
      data.accessJwt,
    )
    const [namedPost, ...replies] = await hydrateAuthorNames(posts)
    return { post: namedPost, replies: replies.map((reply, index) => ({ post: reply, parentUri: thread.replies[index].parentUri })) }
}

export const getPostThread = createServerFn({ method: 'POST' })
  .validator((data: PostThreadInput) => data)
  .handler(({ data }) => loadPostThread(data))

const clientThreadRequests = new Map<string, Promise<PostThread>>()

export function loadCachedThread(data: PostThreadInput): Promise<PostThread> {
  const cached = readCachedThread(data.uri, data.did)
  if (cached) return Promise.resolve(cached)
  const key = threadCacheKey(data.uri, data.did)
  let request = clientThreadRequests.get(key)
  if (!request) {
    request = getPostThread({ data }).then((thread) => {
      writeCachedThread(thread, data.did)
      return thread
    }).finally(() => clientThreadRequests.delete(key))
    clientThreadRequests.set(key, request)
  }
  return request
}

type TextPostInput = {
    did: string
    accessJwt: string
    text: string
    category: PostCategory
    rkey: string
    createdAt: string
    images?: PdsImage[]
}

export const uploadPostImage = createServerFn({ method: 'POST' })
  .validator((data: { accessJwt: string; base64: string; contentType: string }) => data)
  .handler(({ data }) => uploadPdsImage(data.accessJwt, data.base64, data.contentType))

export async function createTextPostRecord(data: TextPostInput) {
    const text = data.text.trim()
    const images = data.images ?? []
    if (!Array.isArray(images)) throw new Error('图片信息无效，请重新添加。')
    if (!text && !images.length) throw new Error('请填写帖子内容或添加图片')
    if (text.length > MAX_POST_TEXT_LENGTH) throw new Error(`帖子内容最多 ${MAX_POST_TEXT_LENGTH} 个字符`)
    if (images.length > MAX_POST_IMAGES) throw new Error(`帖子最多添加 ${MAX_POST_IMAGES} 张图片。`)
    if (images.some((item) => item.image?.$type !== 'blob' || !item.image.ref?.$link || !POST_IMAGE_TYPES.includes(item.image.mimeType) || !Number.isFinite(item.image.size) || item.image.size <= 0 || item.image.size > MAX_POST_IMAGE_BYTES || typeof item.alt !== 'string')) throw new Error('图片信息无效，请重新添加。')
    if (images.some((item) => !item.aspectRatio || !Number.isInteger(item.aspectRatio.width) || item.aspectRatio.width < 1 || !Number.isInteger(item.aspectRatio.height) || item.aspectRatio.height < 1)) throw new Error('图片尺寸无效，请重新添加。')
    if (!['post', 'activity', 'product'].includes(data.category)) {
      throw new Error('内容分类无效')
    }

    const createdAt = data.createdAt
    const record = {
      $type: 'app.bsky.feed.post', text, langs: ['zh'], xjdaoCategory: data.category, createdAt,
      ...(images.length ? { embed: postImageEmbed(images) } : {}),
    }
    let body: { uri: string; cid: string }
    try { body = await createPdsRecord(data.accessJwt, {
      repo: data.did,
      collection: 'app.bsky.feed.post',
      rkey: data.rkey,
      record,
    }) } catch (error) {
      // A create may have succeeded before its response was lost. Read the same key;
      // never retry by creating another record or overwrite the published one.
      const query = new URLSearchParams({ repo: data.did, collection: 'app.bsky.feed.post', rkey: data.rkey })
      const existing = await requestJson<{ uri: string; cid: string; value: typeof record }>(`${BACKEND_BASE}/pds/xrpc/com.atproto.repo.getRecord?${query}`, { headers: { Authorization: `Bearer ${data.accessJwt}` } }).catch(() => { throw error })
      const imageIdentity = (embed: typeof record.embed) => [embed?.$type, (embed?.items ?? []).map((item) => [item.image.ref.$link, item.alt, item.aspectRatio?.width, item.aspectRatio?.height])]
      if (existing.value.text !== text || existing.value.createdAt !== createdAt || existing.value.xjdaoCategory !== data.category || JSON.stringify(imageIdentity(existing.value.embed)) !== JSON.stringify(imageIdentity(record.embed))) throw new Error('上次提交的帖子已发布。请离开发布页面后查看，再发布新内容。')
      body = existing
    }
    return { uri: body.uri, cid: body.cid, text, createdAt, category: data.category, ...(images.length ? { images } : {}) }
}

export const createTextPost = createServerFn({ method: 'POST' })
  .validator((data: TextPostInput) => data)
  .handler(({ data }) => createTextPostRecord(data))

type DeletePostInput = {
  did: string
  accessJwt: string
  uri: string
}

export async function deleteOwnPostRecord(data: DeletePostInput) {
  const collection = 'app.bsky.feed.post'
  if (!data.uri.startsWith(`at://${data.did}/${collection}/`)) {
    throw new Error('只能删除自己的帖子')
  }

  await deletePdsRecord(data.accessJwt, {
    repo: data.did,
    collection,
    rkey: recordKeyFromUri(data.uri, collection),
  })
  return { uri: data.uri }
}

export const deletePost = createServerFn({ method: 'POST' })
  .validator((data: DeletePostInput) => data)
  .handler(({ data }) => deleteOwnPostRecord(data))

type ToggleInteractionInput = {
  did: string
  accessJwt: string
  postUri: string
  postCid: string
  recordUri?: string
}

export async function updateInteractionRecord(
  data: ToggleInteractionInput,
  collection: InteractionCollection,
) {
  if (data.recordUri) {
    if (!ownedInteractionUri(data.recordUri, data.did, collection)) throw new Error('只能取消当前账号的点赞或转发')
    await deletePdsRecord(data.accessJwt, {
      repo: data.did,
      collection,
      rkey: recordKeyFromUri(data.recordUri, collection),
    })
    return { recordUri: null, indexedAt: null }
  }

  const indexedAt = new Date().toISOString()
  const record = await createPdsRecord(data.accessJwt, {
    repo: data.did,
    collection,
    record: {
      $type: collection,
      subject: { uri: data.postUri, cid: data.postCid },
      createdAt: indexedAt,
    },
  })
  return { recordUri: record.uri, indexedAt }
}

export const toggleLike = createServerFn({ method: 'POST' })
  .validator((data: ToggleInteractionInput) => data)
  .handler(({ data }) => updateInteractionRecord(data, 'app.bsky.feed.like'))

export const toggleRepost = createServerFn({ method: 'POST' })
  .validator((data: ToggleInteractionInput) => data)
  .handler(({ data }) => updateInteractionRecord(data, 'app.bsky.feed.repost'))

export const createReply = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      did: string
      accessJwt: string
      text: string
      root: { uri: string; cid: string }
      parent: { uri: string; cid: string }
    }) => data,
  )
  .handler(async ({ data }) => {
    const text = data.text.trim()
    if (!text) throw new Error('评论内容不能为空')
    if (text.length > MAX_POST_TEXT_LENGTH) throw new Error(`评论最多 ${MAX_POST_TEXT_LENGTH} 个字符`)

    const createdAt = new Date().toISOString()
    const record = await createPdsRecord(data.accessJwt, {
      repo: data.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        langs: ['zh'],
        reply: { root: data.root, parent: data.parent },
        createdAt,
      },
    })
    return { ...record, text, createdAt }
  })
