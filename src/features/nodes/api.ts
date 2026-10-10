import { createServerFn } from '@tanstack/react-start'
import { backendData, searchParams } from '~/lib/http'
import type { RiceAttachment, RicePublicUser } from '~/lib/models'
import { withProfileAvatars } from '../social/api'

export type NodeApplication = { id: string; status: 'pending' | 'approved' | 'rejected'; reason: string; review_reason: string | null; inserted_at: string; reviewed_at: string | null; user?: RicePublicUser }
export type CommunityNode = {
  id: string; name: string; description: string | null; position?: number | null; logo: RiceAttachment | null;
  grain_balance: number; grain_frozen_balance: number;
  owner: RicePublicUser | null; role: 'admin' | 'member' | null; my_application: NodeApplication | null;
  can_manage_members?: boolean;
  members?: Array<{ user: RicePublicUser; role: 'admin' | 'member' }>; applications?: NodeApplication[]
}
export type NodeMine = 'joined' | 'pending' | 'managed' | 'identity'
export const getNodes = createServerFn({ method: 'POST' })
  .validator((data: { token?: string; q?: string; mine?: NodeMine }) => data)
  .handler(async ({ data }) => backendData<CommunityNode[]>(`/api/nodes?${searchParams({ q: data.q, mine: data.mine })}`, { token: data.token }))
export const getNode = createServerFn({ method: 'POST' })
  .validator((data: { token?: string; id: string }) => data)
  .handler(async ({ data }) => {
    const node = await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.id)}`, { token: data.token })
    if (!node.members?.length) return node
    const users = await withProfileAvatars(node.members.map(({ user }) => user))
    return { ...node, members: node.members.map((member, i) => ({ ...member, user: users[i] })) }
  })
export const applyToNode = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; reason: string }) => data)
  .handler(async ({ data }) => backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/applications`, { method: 'POST', token: data.token, json: { reason: data.reason } }))
export const reviewNodeApplication = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; applicationId: string; action: 'approve' | 'reject' }) => data)
  .handler(async ({ data }) => backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/applications/${encodeURIComponent(data.applicationId)}/${data.action}`, { method: 'POST', token: data.token }))

export const updateNodeMemberRole = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; userId: string; role: 'admin' | 'member' }) => data)
  .handler(async ({ data }) => backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/members/${encodeURIComponent(data.userId)}`, {
    method: 'PATCH', token: data.token, json: { role: data.role },
  }))
