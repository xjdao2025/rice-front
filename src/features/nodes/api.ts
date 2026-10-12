import { createServerFn } from '@tanstack/react-start'
import { backendData, searchParams } from '~/lib/http'
import type { RiceAttachment, RicePublicUser } from '~/lib/models'
import { withAvatars } from '../social/api'

export type NodeApplication = { id: string; status: 'pending' | 'approved' | 'rejected'; reason: string; review_reason: string | null; inserted_at: string; reviewed_at: string | null; user?: RicePublicUser }
export type CommunityNode = {
  id: string; name: string; description: string | null; position?: number | null; logo: RiceAttachment | null;
  grain_balance: number; grain_frozen_balance: number;
  // owner 的余额仅表示负责人个人账户；节点资金使用顶层余额。
  owner: (RicePublicUser & { grain_balance: number; grain_frozen_balance: number }) | null; role: 'admin' | 'member' | null; my_application: NodeApplication | null;
  can_manage_members?: boolean;
  members?: Array<{ user: RicePublicUser; role: 'admin' | 'member' }>; applications?: NodeApplication[]
}
export type NodeMine = 'joined' | 'pending' | 'managed' | 'identity'
export const getNodes = createServerFn({ method: 'POST' })
  .validator((data: { token?: string; q?: string; mine?: NodeMine }) => data)
  .handler(async ({ data }) => backendData<CommunityNode[]>(`/api/nodes?${searchParams({ q: data.q, mine: data.mine })}`, { token: data.token }))
export const getNode = createServerFn({ method: 'POST' })
  .validator((data: { token?: string; id: string }) => data)
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.id)}`, { token: data.token })))
export const applyToNode = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; reason: string }) => data)
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/applications`, { method: 'POST', token: data.token, json: { reason: data.reason } })))
export const reviewNodeApplication = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; applicationId: string; action: 'approve' | 'reject' }) => data)
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/applications/${encodeURIComponent(data.applicationId)}/${data.action}`, { method: 'POST', token: data.token })))

export const updateNodeMemberRole = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; userId: string; role: 'admin' | 'member' }) => data)
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/members/${encodeURIComponent(data.userId)}`, {
    method: 'PATCH', token: data.token, json: { role: data.role },
  })))
