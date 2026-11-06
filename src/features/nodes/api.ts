import { createServerFn } from '@tanstack/react-start'
import { credential, id, object, oneOf, optional, text } from '~/lib/validation'
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
  .validator(object({ token: optional(credential), q: optional(text(256)), mine: optional(oneOf(['joined', 'pending', 'managed', 'identity'])) }))
  .handler(async ({ data }) => backendData<CommunityNode[]>(`/api/nodes?${searchParams({ q: data.q, mine: data.mine })}`, { token: data.token }))
export const getNode = createServerFn({ method: 'POST' })
  .validator(object({ token: optional(credential), id }))
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.id)}`, { token: data.token })))
export const applyToNode = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, nodeId: id, reason: text(512) }))
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/applications`, { method: 'POST', token: data.token, json: { reason: data.reason } })))
export const reviewNodeApplication = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, nodeId: id, applicationId: id, action: oneOf(['approve', 'reject']) }))
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/applications/${encodeURIComponent(data.applicationId)}/${data.action}`, { method: 'POST', token: data.token })))

export const updateNodeMemberRole = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, nodeId: id, userId: id, role: oneOf(['admin', 'member']) }))
  .handler(async ({ data }) => withAvatars(await backendData<CommunityNode>(`/api/nodes/${encodeURIComponent(data.nodeId)}/members/${encodeURIComponent(data.userId)}`, {
    method: 'PATCH', token: data.token, json: { role: data.role },
  })))
