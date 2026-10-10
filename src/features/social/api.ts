import { createServerFn } from '@tanstack/react-start'

import { backend, searchParams } from '~/lib/http'
import type { RicePublicUser, SocialConnectionPage, SocialProfile } from '~/lib/models'
import { appviewImageUrl, createPdsRecord, deleteOwnRecord, xrpcGet } from '~/lib/pds'

export type SocialConnectionKind = 'followers' | 'following'

export type UserSearchPage = { data: RicePublicUser[]; meta: { next_cursor: string | null } }

async function loadUserSearch(data: { q: string; before?: string }) {
  const q = data.q.trim()
  if (!q) return { data: [], meta: { next_cursor: null } } satisfies UserSearchPage
  const page = await backend<UserSearchPage>(`/api/users/search?${searchParams({ q, limit: '10', before: data.before })}`)
  return { ...page, data: await withProfileAvatars(page.data) }
}

export const searchUsers = createServerFn({ method: 'POST' })
  .validator((data: { q: string; before?: string }) => data)
  .handler(({ data }) => loadUserSearch(data))

/**
 * rice 用户大多没在 rice 传过头像，头像在 AT 资料里。补上缺的那些（rice 自己的优先，和个人主页一致）；
 * AppView 不可用时原样返回。只在服务端调用。
 */
export async function withProfileAvatars<T extends { did: string; avatar: { url: string } | null }>(users: T[]): Promise<T[]> {
  const missing = [...new Set(users.filter((user) => !user.avatar).map((user) => user.did))]
  const avatars = new Map<string, string>()
  for (let i = 0; i < missing.length; i += 25) {
    const params = new URLSearchParams(missing.slice(i, i + 25).map((did) => ['actors', did]))
    const page = await xrpcGet<{ profiles?: Array<{ did: string; avatar?: string }> }>('app.bsky.actor.getProfiles', params).catch(() => null)
    for (const { did, avatar } of page?.profiles ?? []) if (avatar) avatars.set(did, appviewImageUrl(avatar))
  }
  return users.map((user) => !user.avatar && avatars.has(user.did) ? { ...user, avatar: { url: avatars.get(user.did)! } } : user)
}

export function normalizeSocialProfile(value: unknown): SocialProfile {
  const profile = (value ?? {}) as Record<string, unknown>
  if (typeof profile.did !== 'string' || typeof profile.handle !== 'string') {
    throw new Error('用户资料暂时无法显示')
  }
  const viewer = (profile.viewer ?? {}) as Record<string, unknown>
  // Optional keys stay absent (not undefined) when missing or empty.
  const str = <K extends string>(key: K, value: unknown, map = (text: string) => text) =>
    typeof value === 'string' && value ? { [key]: map(value) } as Record<K, string> : {}
  const num = (value: unknown) => typeof value === 'number' ? value : 0
  const viewerState = {
    ...(typeof viewer.following === 'string' ? { following: viewer.following } : {}),
    ...(typeof viewer.followedBy === 'string' ? { followedBy: viewer.followedBy } : {}),
  }
  return {
    did: profile.did,
    handle: profile.handle,
    ...str('displayName', profile.displayName),
    ...str('description', profile.description),
    ...str('avatar', profile.avatar, appviewImageUrl),
    followersCount: num(profile.followersCount),
    followsCount: num(profile.followsCount),
    postsCount: num(profile.postsCount),
    ...(Object.keys(viewerState).length ? { viewer: viewerState } : {}),
  }
}

export async function loadSocialProfile(actor: string, accessJwt?: string) {
  const [pds, rice] = await Promise.allSettled([
    xrpcGet<unknown>('app.bsky.actor.getProfile', new URLSearchParams({ actor }), accessJwt),
    backend<{ data: RicePublicUser }>(`/api/users/${encodeURIComponent(actor)}/profile`),
  ])
  const social = pds.status === 'fulfilled' ? normalizeSocialProfile(pds.value) : null
  if (rice.status === 'fulfilled') {
    const profile = rice.value.data
    return { ...(social ?? { followersCount: 0, followsCount: 0, postsCount: 0 }), socialAvailable: Boolean(social), did: profile.did, handle: profile.handle, displayName: profile.nickname || social?.displayName, description: profile.bio || social?.description, avatar: profile.avatar?.url || social?.avatar } satisfies SocialProfile
  }
  if (social) return social
  throw new Error('用户资料暂时无法显示')
}

type ConnectionsInput = { actor: string; kind: SocialConnectionKind; cursor?: string; accessJwt?: string }
type FollowInput = { did: string; accessJwt: string; targetDid: string; recordUri?: string }

export async function loadSocialConnections(data: ConnectionsInput): Promise<SocialConnectionPage> {
  const [method, listKey] = data.kind === 'followers' ? ['getFollowers', 'followers'] : ['getFollows', 'follows']
  const body = await xrpcGet<Record<string, unknown>>(
    `app.bsky.graph.${method}`, searchParams({ actor: data.actor, limit: '30', cursor: data.cursor }), data.accessJwt,
  )
  const profiles = Array.isArray(body[listKey]) ? body[listKey] : []
  return {
    subject: normalizeSocialProfile(body.subject),
    profiles: profiles.map(normalizeSocialProfile),
    ...(typeof body.cursor === 'string' ? { cursor: body.cursor } : {}),
  }
}

export async function updateFollowRecord(data: FollowInput) {
  const collection = 'app.bsky.graph.follow'
  if (data.recordUri) {
    await deleteOwnRecord(data.accessJwt, data.did, collection, data.recordUri)
    return { recordUri: null }
  }
  if (data.did === data.targetDid) throw new Error('不能关注自己')
  const record = await createPdsRecord(data.accessJwt, {
    repo: data.did,
    collection,
    record: { $type: collection, subject: data.targetDid, createdAt: new Date().toISOString() },
  })
  return { recordUri: record.uri }
}

export const getSocialProfile = createServerFn({ method: 'POST' })
  .validator((data: { actor: string; accessJwt?: string }) => data)
  .handler(({ data }) => loadSocialProfile(data.actor, data.accessJwt))

export const getSocialConnections = createServerFn({ method: 'POST' })
  .validator((data: ConnectionsInput) => data)
  .handler(({ data }) => loadSocialConnections(data))

export const toggleFollow = createServerFn({ method: 'POST' })
  .validator((data: FollowInput) => data)
  .handler(({ data }) => updateFollowRecord(data))
