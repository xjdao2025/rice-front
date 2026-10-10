import { createFileRoute } from '@tanstack/react-router'

import { ProfilePage, type ProfileInitialData } from '~/features/profile/ProfilePage'
import { getCurrentUser } from '~/features/session/api'
import { readStoredSession, writeStoredSession } from '~/features/session/session'
import { getWallet } from '~/features/grains/api'
import { getNodes } from '~/features/nodes/api'
import { errorMessage } from '~/lib/util'
import { isStoredSession } from './-loaders'

export const Route = createFileRoute('/me/')({
  ssr: false,
  staleTime: 30_000,
  preloadStaleTime: 30_000,
  loaderDeps: () => {
    const session = readStoredSession()
    // Client-only cache identity; never a search parameter or URL.
    return { accountId: session?.user.id ?? null, token: session?.token ?? null }
  },
  beforeLoad: ({ matches }): { previousData: ProfileInitialData | null } => {
    const previous = matches.find((match) => match.routeId === '/me/')?.loaderData as { initialData: ProfileInitialData | null } | undefined
    return { previousData: previous?.initialData ?? null }
  },
  loader: { staleReloadMode: 'background', handler: async ({ deps, context }) => {
    const empty = { initialData: null, error: '' }
    const { token, accountId } = deps
    if (!token || !accountId) return empty
    const isCurrentSession = () => isStoredSession(accountId, token)
    if (!isCurrentSession()) return empty
    const communitiesRequest = getNodes({ data: { token, mine: 'managed' } })
      .then(async (nodes) => ({
        communities: await Promise.all(nodes.filter((node) => node.role === 'admin').map(async ({ id, name }) => {
          try {
            const wallet = await getWallet({ data: { token, nodeId: id } })
            return { id, name, wallet }
          } catch {
            return { id, name, wallet: null, error: '节点稻米暂时无法加载，请稍后重试。' }
          }
        })),
      }))
      .catch(() => ({ communities: [], communityError: '暂时无法加载管理的节点，请稍后重试。' }))
    try {
      const userRequest = getCurrentUser({ data: token }).then((user) => {
        if (user === null && isCurrentSession()) writeStoredSession(null)
        return user
      })
      const [user, wallet, communities] = await Promise.all([userRequest, getWallet({ data: { token } }), communitiesRequest])
      if (!isCurrentSession() || !user) return empty
      // 会话里的用户是登录时存的；资料（含从 AT 补的头像）有变就同步，收稻米页等直接读会话的地方才跟得上
      const stored = readStoredSession()
      if (stored && JSON.stringify(stored.user) !== JSON.stringify(user)) writeStoredSession({ ...stored, user })
      return { initialData: { user, wallet, accountId, sessionToken: token, ...communities }, error: '' }
    } catch (error) {
      const communities = await communitiesRequest
      if (!isCurrentSession()) return empty
      const previous = context.previousData
      // Keep personal data on refresh failures, but never restore old community permissions.
      const initialData = previous?.accountId === accountId && previous.sessionToken === token ? { ...previous, communityError: undefined, ...communities } : null
      return { initialData, error: error instanceof TypeError ? '网络连接失败，请检查网络后重试。' : errorMessage(error, '个人资料暂时无法加载，请稍后重试。') }
    }
  } },
  component: () => { const { initialData, error } = Route.useLoaderData(); return <ProfilePage initialData={initialData} initialError={error} /> },
})
