import { createFileRoute } from '@tanstack/react-router'

import {
  getPosts,
  readCachedFeed,
  writeCachedFeed,
} from '~/features/feed/api'
import { PlazaPage } from '~/features/feed/PlazaPage'
import { getBanners } from '~/features/feed/banners'
import { isPlazaTag, type PlazaTag } from '~/features/feed/tags'
import { readStoredSession, refreshStoredSession, tokenExpiresSoon } from '~/features/session/session'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { tag?: PlazaTag } => isPlazaTag(search.tag) ? { tag: search.tag } : {},
  loaderDeps: ({ search }) => ({ tag: search.tag }),
  loader: {
    handler: async ({ deps: { tag } }) => {
      const bannersPromise = getBanners().catch(() => [])
      let session = readStoredSession()
      // 按标签看的那一页不进缓存:缓存只存完整的首页
      const cachedFeed = tag ? null : readCachedFeed(session?.pds.did)
      if (cachedFeed) return { feed: cachedFeed, banners: await bannersPromise }
      if (session && tokenExpiresSoon(session.pds.access_jwt)) {
        await refreshStoredSession(session).catch(() => undefined)
        session = readStoredSession()
      }
      const feed = await getPosts({
        data: {
          accessJwt: session?.pds.access_jwt,
          did: session?.pds.did,
          tag,
        },
      })
      if (!tag) writeCachedFeed(feed, session?.pds.did)
      return { feed, banners: await bannersPromise }
    },
    staleReloadMode: 'blocking',
  },
  component: PlazaRoute,
})

function PlazaRoute() {
  const { feed, banners } = Route.useLoaderData()
  const { tag } = Route.useSearch()
  return <PlazaPage initialFeed={feed} banners={banners} tag={tag} />
}
