import { createServerFn } from '@tanstack/react-start'
import { BACKEND_BASE, requestJson } from '~/lib/http'
import type { RiceAttachment, RicePublicUser } from '~/lib/models'

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
  .handler(async ({ data }) => {
    const query = new URLSearchParams()
    if (data.q) query.set('q', data.q)
    if (data.mine) query.set('mine', data.mine)
    return (await requestJson<{ data: CommunityNode[] }>(`${BACKEND_BASE}/api/nodes?${query}`, { headers: data.token ? { Authorization: `Bearer ${data.token}` } : undefined })).data
  })
export const getNode = createServerFn({ method: 'POST' })
  .validator((data: { token?: string; id: string }) => data)
  .handler(async ({ data }) => (await requestJson<{ data: CommunityNode }>(`${BACKEND_BASE}/api/nodes/${encodeURIComponent(data.id)}`, { headers: data.token ? { Authorization: `Bearer ${data.token}` } : undefined })).data)
export const applyToNode = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; reason: string }) => data)
  .handler(async ({ data }) => (await requestJson<{ data: CommunityNode }>(`${BACKEND_BASE}/api/nodes/${encodeURIComponent(data.nodeId)}/applications`, { method: 'POST', headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: data.reason }) })).data)
export const reviewNodeApplication = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; applicationId: string; action: 'approve' | 'reject' }) => data)
  .handler(async ({ data }) => (await requestJson<{ data: CommunityNode }>(`${BACKEND_BASE}/api/nodes/${encodeURIComponent(data.nodeId)}/applications/${encodeURIComponent(data.applicationId)}/${data.action}`, { method: 'POST', headers: { Authorization: `Bearer ${data.token}` } })).data)

export const updateNodeMemberRole = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; userId: string; role: 'admin' | 'member' }) => data)
  .handler(async ({ data }) => (await requestJson<{ data: CommunityNode }>(`${BACKEND_BASE}/api/nodes/${encodeURIComponent(data.nodeId)}/members/${encodeURIComponent(data.userId)}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: data.role }),
  })).data)
