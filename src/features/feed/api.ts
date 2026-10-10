import { createServerFn } from '@tanstack/react-start'

import { backend, backendData, isSessionAuthError, searchParams } from '~/lib/http'
import type { PdsImage, PostCategory, PostFeed, PostImage, PostThread, PostView, RicePublicUser, RiceSession } from '~/lib/models'
import { appviewImageUrl, createPdsRecord, deleteOwnRecord, MAX_POST_IMAGE_BYTES, MAX_POST_IMAGES, MAX_POST_TEXT_LENGTH, pdsGet, thumbUrl, POST_IMAGE_TYPES, uploadPdsImage, xrpcGet } from '~/lib/pds'

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

/** Rebuilds this reader's cached plaza with `posts(current)`; returns false when it isn't cached. */
function updateCachedPosts(did: string | undefined, posts: (current: PostView[]) => PostView[]) {
  if (clientFeedCache?.owner !== (did ?? null)) return false
  clientFeedCache = { owner: did ?? null, feed: { ...clientFeedCache.feed, posts: posts(clientFeedCache.feed.posts) } }
  return true
}

const deleteThreads = (matches: (key: string) => boolean) => {
  for (const key of clientThreadCache.keys()) if (matches(key)) clientThreadCache.delete(key)
}

export function prependCachedPost(post: PostView, did?: string) {
  if (typeof window === 'undefined') return
  if (!updateCachedPosts(did, (posts) => [post, ...posts.filter((item) => item.uri !== post.uri)])) {
    // Publishing from another page must not depend on having opened the plaza.
    clientFeedCache = { owner: did ?? null, feed: { posts: [post], cursor: '1' } }
  }
}

export function hideDeletedPost(uri: string, did?: string) {
  if (typeof window === 'undefined') return
  clientDeletedPostUris.add(uri)
  deleteThreads((key) => key.endsWith(`\0${uri}`))
  if (clientSelectedPost?.post.uri === uri) clientSelectedPost = null
  updateCachedPosts(did, (posts) => posts.filter((post) => post.uri !== uri))
}

export function isPostHidden(uri: string) {
  return typeof window !== 'undefined' && clientDeletedPostUris.has(uri)
}

export function clearCachedFeed(did?: string) {
  deleteThreads((key) => key.startsWith(`${did ?? ''}\0`))
  if (typeof window !== 'undefined' && clientFeedCache?.owner === (did ?? null)) clientFeedCache = null
}

function postImageEmbed(images: PdsImage[]) {
  return { $type: 'app.bsky.embed.gallery', items: images.map(({ image, alt, aspectRatio }) => ({ $type: 'app.bsky.embed.gallery#image' as const, image, alt, aspectRatio })) }
}

export function createdPostView(
  created: Pick<CreatedPost, 'uri' | 'cid' | 'text' | 'createdAt'> & { category?: PostCategory; images?: PdsImage[] },
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
    ...(created.images?.length ? { images: created.images.map((item) => ({ ...postImage(session.pds.did, item.image.ref.$link), alt: item.alt, ...item.aspectRatio })) } : {}),
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

async function hydrateViewerRecords(posts: PostView[], did?: string, accessJwt?: string) {
  // Lists are fetched without the reader's token, so any viewer state is not theirs.
  const publicPosts = posts.map(({ viewer: _viewer, ...post }) => post)
  if (!did || !accessJwt || posts.length === 0) return publicPosts

  const subjects = new Set(posts.map((post) => post.uri))
  const list = async (collection: InteractionCollection) => {
    // ponytail: Scan the reader's records; use authenticated AppView lookups if histories become large.
    const found = new Map<string, string>()
    let cursor: string | undefined
    do {
      const body = await pdsGet<{ records?: Array<{ uri: string; value?: { subject?: { uri?: string } } }>; cursor?: string }>(
        'com.atproto.repo.listRecords', searchParams({ repo: did, collection, limit: '100', cursor }), accessJwt,
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
    const [likes, reposts] = await Promise.all([list('app.bsky.feed.like'), list('app.bsky.feed.repost')])
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
    const profile = await backend<{ data: RicePublicUser }>(`/api/users/${encodeURIComponent(did)}/profile`).catch(() => null)
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

const postImage = (did: string, cid: string) => ({ src: thumbUrl('feed', did, cid), fullsize: thumbUrl('full', did, cid) })

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
    const original = originals?.[index] as typeof item | undefined
    const cid = item.image?.ref?.$link ?? item.image?.cid ?? original?.image?.ref?.$link ?? original?.image?.cid
    const alt = typeof item.alt === 'string' ? item.alt : ''
    if (typeof cid === 'string' && /^[a-z0-9]+$/i.test(cid)) return [{ ...postImage(post.author.did, cid), alt, ...item.aspectRatio }]
    const viewUrl = (url: unknown) => typeof url === 'string' && /^https?:\/\//i.test(url) ? appviewImageUrl(url) : undefined
    const fullsize = viewUrl(item.fullsize)
    const src = viewUrl(item.thumb) ?? viewUrl(item.thumbnail) ?? fullsize
    if (!src) return []
    return [{ src, ...(fullsize ? { fullsize } : {}), alt, ...item.aspectRatio }]
  })
  return images.length ? { ...post, images } : post
}

export function normalizePostFeed(payload: unknown): PostFeed {
  const body = (payload ?? {}) as { posts?: Array<PostView | { post?: PostView; reply?: unknown; reason?: PostView['reason'] }> }
  const posts = (body.posts ?? [])
    .map((item): PostView | undefined => {
      if (!('post' in item)) return item as PostView
      if (!item.post || item.reply) return undefined
      return item.reason ? { ...item.post, reason: item.reason } : item.post
    })
    .filter((post): post is PostView => Boolean(post?.uri && post.record?.text !== undefined && !post.record.reply))
    .map(normalizePostImages)
  return { posts }
}

async function loadTimelineReposts(accessJwt?: string) {
  if (!accessJwt) return []
  try {
    const payload = await pdsGet<{ feed?: unknown[] }>('app.bsky.feed.getTimeline', 'limit=50', accessJwt)
    return normalizePostFeed({ posts: payload.feed }).posts.filter((post) => post.reason?.$type === 'app.bsky.feed.defs#reasonRepost')
  } catch (error) {
    if (isSessionAuthError(error)) throw error
    return []
  }
}

async function loadOwnRecentPosts(did: string, accessJwt: string) {
  // Read-your-writes: the PDS has committed before the shared index/AppView catches up.
  const params = new URLSearchParams({ repo: did, collection: 'app.bsky.feed.post', limit: String(FEED_PAGE_SIZE) })
  const payload = await pdsGet<{ records?: Array<{ uri: string; cid: string; value: PostView['record'] }> }>(
    'com.atproto.repo.listRecords', params, accessJwt,
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
    .sort((a, b) => sortAt(b).localeCompare(sortAt(a)))
}

// AppView 的 sortAt:min(createdAt, indexedAt)。迁移后重新索引过的旧帖 indexedAt 全是索引那天,
// 只按 indexedAt 排会打乱;转发按转发时间。
function sortAt(post: PostView) {
  if (post.reason) return post.reason.indexedAt
  const created = post.record.createdAt
  return created && created < post.indexedAt ? created : post.indexedAt
}

export function normalizePostThread(payload: unknown): PostThread {
  const body = payload as { thread?: { post?: PostView; replies?: unknown[] } }
  const post = body.thread?.post
  if (!post?.uri || post.record?.text === undefined) throw new Error('帖子暂时无法显示')
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
  query?: string; repo?: string; tag?: string; category?: PostCategory; cursor?: string; limit?: number; accessJwt?: string; did?: string
}

// aerox.feed.listPosts:只有顶层帖子(不含回复)、最新在前,下架的不出现。公开接口,直接走 AppView。
export async function loadPostPage(data: GetPostsInput) {
  const query = data.query?.trim()
  const first = !data.cursor
  const payload = await backend<{ cursor?: string }>(`/bsky/xrpc/aerox.feed.listPosts?${searchParams({
    q: query, author: data.repo, tag: data.tag?.replace(/^#/, ''), limit: data.limit ?? (query ? 25 : FEED_PAGE_SIZE), cursor: data.cursor,
  })}`)

  const feed = normalizePostFeed(payload)
  const [timelineReposts, ownPosts] = await Promise.all([
    !query && !data.repo && first ? loadTimelineReposts(data.accessJwt) : [],
    !query && first && data.did && data.accessJwt && (!data.repo || data.repo === data.did)
      ? loadOwnRecentPosts(data.did, data.accessJwt) : [],
  ])
  const indexedUris = new Set(feed.posts.map(post => post.uri))
  const posts = mergeFeedPosts([...feed.posts, ...ownPosts.filter(post => !indexedUris.has(post.uri))], timelineReposts).filter((post) =>
    (!data.tag || hasPostTag(post.record.text, data.tag)) && (!data.category || postCategory(post.record) === data.category))
  return {
    posts: await hydrateAuthorNames(await hydrateViewerRecords(posts, data.did, data.accessJwt)),
    cursor: payload.cursor || null,
  }
}

export const getPosts = createServerFn({ method: 'POST' })
  .validator((data: GetPostsInput) => data)
  .handler(({ data }) => loadPostPage(data))

type PostThreadInput = { uri: string; accessJwt?: string; did?: string }
export async function loadPostThread(data: PostThreadInput): Promise<PostThread> {
  const params = new URLSearchParams({ uri: data.uri, depth: '2', parentHeight: '0' })
  const thread = normalizePostThread(await xrpcGet<unknown>('app.bsky.feed.getPostThread', params, data.accessJwt))
  const posts = await hydrateViewerRecords([thread.post, ...thread.replies.map((reply) => reply.post)], data.did, data.accessJwt)
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

type PdsAuth = { did: string; accessJwt: string }
type TextPostInput = PdsAuth & { text: string; category: PostCategory; rkey: string; createdAt: string; images?: PdsImage[] }
type CreatedPost = Awaited<ReturnType<typeof createTextPostRecord>>

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
  if (!['post', 'activity', 'product'].includes(data.category)) throw new Error('内容分类无效')

  const createdAt = data.createdAt
  const record = {
    $type: 'app.bsky.feed.post', text, langs: ['zh'], xjdaoCategory: data.category, createdAt,
    ...(images.length ? { embed: postImageEmbed(images) } : {}),
  }
  let body: { uri: string; cid: string }
  try {
    body = await createPdsRecord(data.accessJwt, { repo: data.did, collection: 'app.bsky.feed.post', rkey: data.rkey, record })
  } catch (error) {
    // A create may have succeeded before its response was lost. Read the same key;
    // never retry by creating another record or overwrite the published one.
    const query = new URLSearchParams({ repo: data.did, collection: 'app.bsky.feed.post', rkey: data.rkey })
    const existing = await pdsGet<{ uri: string; cid: string; value: typeof record }>('com.atproto.repo.getRecord', query, data.accessJwt).catch(() => { throw error })
    const imageIdentity = (embed: typeof record.embed) => [embed?.$type, (embed?.items ?? []).map((item) => [item.image.ref.$link, item.alt, item.aspectRatio?.width, item.aspectRatio?.height])]
    if (existing.value.text !== text || existing.value.createdAt !== createdAt || existing.value.xjdaoCategory !== data.category || JSON.stringify(imageIdentity(existing.value.embed)) !== JSON.stringify(imageIdentity(record.embed))) throw new Error('上次提交的帖子已发布。请离开发布页面后查看，再发布新内容。')
    body = existing
  }
  return { uri: body.uri, cid: body.cid, text, createdAt, category: data.category, ...(images.length ? { images } : {}) }
}

/** 帖子直接写进用户的 PDS,写之前先让 rice 审一遍(阿里云内容安全);不通过就抛出 rice 的提示,不写 */
export async function moderatePost(token: string, text: string, images: PdsImage[] = []) {
  await backendData('/api/moderation/check', { method: 'POST', token, json: { text, images: images.map((item) => item.image.ref.$link) } })
}

export const createTextPost = createServerFn({ method: 'POST' })
  .validator((data: TextPostInput & { token: string }) => data)
  .handler(async ({ data }) => {
    await moderatePost(data.token, data.text.trim(), data.images)
    return createTextPostRecord(data)
  })

type DeletePostInput = PdsAuth & { uri: string }

export async function deleteOwnPostRecord(data: DeletePostInput) {
  const collection = 'app.bsky.feed.post'
  if (!data.uri.startsWith(`at://${data.did}/${collection}/`)) throw new Error('只能删除自己的帖子')
  await deleteOwnRecord(data.accessJwt, data.did, collection, data.uri)
  return { uri: data.uri }
}

export const deletePost = createServerFn({ method: 'POST' })
  .validator((data: DeletePostInput) => data)
  .handler(({ data }) => deleteOwnPostRecord(data))

type ToggleInteractionInput = PdsAuth & { postUri: string; postCid: string; recordUri?: string }

export async function updateInteractionRecord(data: ToggleInteractionInput, collection: InteractionCollection) {
  if (data.recordUri) {
    if (!ownedInteractionUri(data.recordUri, data.did, collection)) throw new Error('只能取消当前账号的点赞或转发')
    await deleteOwnRecord(data.accessJwt, data.did, collection, data.recordUri)
    return { recordUri: null, indexedAt: null }
  }
  const indexedAt = new Date().toISOString()
  const record = await createPdsRecord(data.accessJwt, {
    repo: data.did,
    collection,
    record: { $type: collection, subject: { uri: data.postUri, cid: data.postCid }, createdAt: indexedAt },
  })
  return { recordUri: record.uri, indexedAt }
}

export const toggleLike = createServerFn({ method: 'POST' })
  .validator((data: ToggleInteractionInput) => data)
  .handler(({ data }) => updateInteractionRecord(data, 'app.bsky.feed.like'))

export const toggleRepost = createServerFn({ method: 'POST' })
  .validator((data: ToggleInteractionInput) => data)
  .handler(({ data }) => updateInteractionRecord(data, 'app.bsky.feed.repost'))

type StrongRef = { uri: string; cid: string }
type ReplyInput = PdsAuth & { token: string; text: string; root: StrongRef; parent: StrongRef }

export const createReply = createServerFn({ method: 'POST' })
  .validator((data: ReplyInput) => data)
  .handler(async ({ data }) => {
    const text = data.text.trim()
    if (!text) throw new Error('评论内容不能为空')
    if (text.length > MAX_POST_TEXT_LENGTH) throw new Error(`评论最多 ${MAX_POST_TEXT_LENGTH} 个字符`)
    await moderatePost(data.token, text)

    const createdAt = new Date().toISOString()
    const record = await createPdsRecord(data.accessJwt, {
      repo: data.did,
      collection: 'app.bsky.feed.post',
      record: { $type: 'app.bsky.feed.post', text, langs: ['zh'], reply: { root: data.root, parent: data.parent }, createdAt },
    })
    return { ...record, text, createdAt }
  })
