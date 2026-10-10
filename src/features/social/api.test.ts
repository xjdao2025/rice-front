import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadSocialConnections,
  loadSocialProfile,
  normalizeSocialProfile,
  updateFollowRecord,
  withProfileAvatars,
} from './api'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const profile = {
  did: 'did:plc:alice',
  handle: 'alice.local.xjdao.xyz',
  displayName: 'Mo Alice',
  followersCount: 2,
  followsCount: 3,
  postsCount: 4,
  viewer: { following: 'at://did:plc:me/app.bsky.graph.follow/abc' },
}

describe('social graph data', () => {
  it('reads legacy public profiles anonymously and preserves PDS fields missing from Rice', async () => {
    vi.stubEnv('XIANGJIAN_APPVIEW_IMAGE_ORIGINS', 'https://old-appview.example')
    const fetchMock = vi.fn(async (url: string | URL) => new Response(JSON.stringify(String(url).includes('/bsky/')
      ? { ...profile, description: '原有简介', avatar: 'https://old-appview.example/img/avatar.jpg' }
      : { data: { did: profile.did, handle: profile.handle, nickname: null, bio: null, avatar: null } })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadSocialProfile(profile.did)).resolves.toMatchObject({ ...profile, description: '原有简介', avatar: '/bsky/img/avatar.jpg' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/bsky/xrpc/app.bsky.actor.getProfile')
  })

  it('shows a legacy PDS user without a Rice account', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).includes('/bsky/')
      ? new Response(JSON.stringify(profile))
      : new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })))
    await expect(loadSocialProfile(profile.did)).resolves.toMatchObject(profile)
  })

  it('keeps the public profile and current viewer relationship', () => {
    expect(normalizeSocialProfile(profile)).toMatchObject(profile)
    expect(normalizeSocialProfile({ did: 'did:plc:bob', handle: 'bob.local' }))
      .toMatchObject({ followersCount: 0, followsCount: 0, postsCount: 0 })
  })

  it('reads either connection list with the same result shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ subject: profile, followers: [profile], cursor: 'next' }), {
        status: 200,
      }),
    ))

    await expect(loadSocialConnections({ actor: profile.did, kind: 'followers' }))
      .resolves.toEqual({ subject: profile, profiles: [profile], cursor: 'next' })
  })

  it('creates and deletes the same follow record', async () => {
    const recordUri = 'at://did:plc:me/app.bsky.graph.follow/3abc'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uri: recordUri, cid: 'cid' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const input = {
      did: 'did:plc:me',
      accessJwt: 'access-token',
      targetDid: profile.did,
    }

    await expect(updateFollowRecord(input)).resolves.toEqual({ recordUri })
    await expect(updateFollowRecord({ ...input, recordUri }))
      .resolves.toEqual({ recordUri: null })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      repo: input.did,
      collection: 'app.bsky.graph.follow',
      record: { subject: profile.did },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      repo: input.did,
      collection: 'app.bsky.graph.follow',
      rkey: '3abc',
    })
  })

})

describe('withProfileAvatars', () => {
  const user = (did: string, avatar: { url: string } | null = null) => ({ did, avatar })

  it('fills only missing avatars from one AppView getProfiles call, keeping rice avatars first', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) => Response.json({ profiles: [
      { did: 'did:plc:a', avatar: 'https://bsky.example/img/avatar/plain/did:plc:a/cid-a' },
      { did: 'did:plc:b' },
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    const users = [user('did:plc:a'), user('did:plc:b'), user('did:plc:c', { url: '/rice.png' }), user('did:plc:a')]

    const filled = await withProfileAvatars(users)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://x.test')
    expect(url.pathname).toBe('/bsky/xrpc/app.bsky.actor.getProfiles')
    expect(url.searchParams.getAll('actors')).toEqual(['did:plc:a', 'did:plc:b'])
    expect(filled.map((u) => u.avatar?.url)).toEqual([expect.stringContaining('cid-a'), undefined, '/rice.png', expect.stringContaining('cid-a')])
  })

  it('returns the users unchanged when AppView is unavailable, and skips the call when nothing is missing', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const users = [user('did:plc:a')]
    expect(await withProfileAvatars(users)).toEqual(users)
    const withRice = [user('did:plc:c', { url: '/rice.png' })]
    fetchMock.mockClear()
    expect(await withProfileAvatars(withRice)).toEqual(withRice)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
