import { createFileRoute } from '@tanstack/react-router'

import {
  getPosts,
  readCachedFeed,
  writeCachedFeed,
} from '~/features/feed/api'
import { PlazaPage } from '~/features/feed/PlazaPage'
import { getBanners } from '~/features/feed/banners'
import { readStoredSession, refreshStoredSession, tokenExpiresSoon } from '~/features/session/session'

export const Route = createFileRoute('/')({
  loader: {
    handler: async () => {
      const bannersPromise = getBanners().catch(() => [])
      let session = readStoredSession()
      const cachedFeed = readCachedFeed(session?.pds.did)
      if (cachedFeed) return { feed: cachedFeed, banners: await bannersPromise }
      if (session && tokenExpiresSoon(session.pds.access_jwt)) {
        await refreshStoredSession(session).catch(() => undefined)
        session = readStoredSession()
      }
      const feed = await getPosts({
        data: {
          accessJwt: session?.pds.access_jwt,
          did: session?.pds.did,
        },
      })
      writeCachedFeed(feed, session?.pds.did)
      return { feed, banners: await bannersPromise }
    },
    staleReloadMode: 'blocking',
  },
  component: PlazaRoute,
})

function PlazaRoute() {
  const { feed, banners } = Route.useLoaderData()
  return <PlazaPage initialFeed={feed} banners={banners} />
}
