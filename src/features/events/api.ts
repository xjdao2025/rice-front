import { createServerFn } from '@tanstack/react-start'
import { BACKEND_BASE, requestJson } from '~/lib/http'
import type { RicePublicUser, RiceAttachment, HistorySnapshot } from '~/lib/models'
import type { CommunityNode } from '../nodes/api'

export type EventStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled'
export type EventApplication = { id: string; round?: number; reason: string; contact?: string | null; status: 'pending' | 'approved' | 'rejected' | 'removed' | 'not_selected' | 'cancelled' | 'withdrawn'; payment_status: 'none' | 'reserved' | 'refunded' | 'settled'; fee_amount?: number; settlement_node_id?: string | null; user: RicePublicUser; inserted_at: string; allowed_actions: string[] }
export type RiceEvent = { can_manage?: boolean; settlement_node_id?: string | null; attachments?: RiceAttachment[]; id: string; round?: number; title: string; description: string; organizer_contact?: string | null; location: string; status: EventStatus; node: Pick<CommunityNode, 'id' | 'name' | 'logo'>; creator: RicePublicUser; fee_amount: number; capacity: number; application_deadline: string; starts_at: string; ends_at: string; published_at: string | null; inserted_at: string; application_count: number; approved_count: number; my_application: EventApplication | null; allowed_actions: string[]; applications: EventApplication[]; past_applications?: EventApplication[]; history: Array<{ id: string; action: string; from_status: string | null; to_status: string; actor: RicePublicUser | null; inserted_at: string; before?: HistorySnapshot | null; after?: HistorySnapshot | null }> }
export const eventStatusLabel: Record<EventStatus, string> = { draft: '草稿', open: '报名中', in_progress: '已开始', completed: '已结束', cancelled: '已取消' }
export function eventAcceptsApplications(event: Pick<RiceEvent, 'status' | 'application_deadline' | 'starts_at' | 'capacity' | 'approved_count'>, now: number) {
  return event.status === 'open' && Date.parse(event.application_deadline) > now && Date.parse(event.starts_at) > now && event.approved_count < event.capacity
}
export function eventDisplayStatus(event: Pick<RiceEvent, 'status' | 'application_deadline' | 'starts_at' | 'ends_at' | 'capacity' | 'approved_count'>, now: number) {
  if (event.status === 'open' || event.status === 'in_progress') {
    if (Date.parse(event.ends_at) <= now) return '等组织者确认结束'
    if (event.status === 'in_progress' || Date.parse(event.starts_at) <= now) return '已开始'
    if (Date.parse(event.application_deadline) <= now) return '报名已截止'
    if (event.approved_count >= event.capacity) return '已满'
  }
  return eventStatusLabel[event.status]
}
export const applicationStatusLabel: Record<EventApplication['status'], string> = { pending: '已报名，等组织者确认', approved: '已通过', rejected: '未通过', removed: '已移除', not_selected: '未入选', cancelled: '已取消', withdrawn: '已撤销' }
export function eventSettlementAmount(event: Pick<RiceEvent, 'applications' | 'approved_count'>) {
  const approved = event.applications.filter(application => application.status === 'approved')
  if (approved.length !== event.approved_count) return null
  let total = 0
  for (const application of approved) {
    const amount = application.fee_amount
    if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0 || (amount > 0 && application.payment_status !== 'reserved')) return null
    total += amount
  }
  return Number.isSafeInteger(total) ? total : null
}
export type EventListInput = { token?: string; q?: string; nodeId?: string; mine?: 'created' | 'applied' | 'managed'; creatorDid?: string; participantDid?: string; status?: EventStatus; before?: string }
export type EventPage = { data: RiceEvent[]; meta?: { next_cursor?: string | null } }
export async function fetchEventPage(data: EventListInput) {
  const q = new URLSearchParams()
  if (data.creatorDid) q.set('creator_did', data.creatorDid)
  if (data.participantDid) q.set('participant_did', data.participantDid)
  if (data.q) q.set('q', data.q)
  if (data.nodeId) q.set('node_id', data.nodeId)
  if (data.mine) q.set('mine', data.mine)
  if (data.status) q.set('status', data.status)
  if (data.before) q.set('before', data.before)
  return requestJson<EventPage>(`${BACKEND_BASE}/api/events?${q}`, { headers: data.token ? { Authorization: `Bearer ${data.token}` } : undefined })
}
export const getEvents = createServerFn({ method: 'POST' }).validator((data: EventListInput) => data).handler(({ data }) => fetchEventPage(data))
export const getEvent = createServerFn({ method: 'POST' }).validator((data: { id: string; token?: string }) => data).handler(async ({ data }) => (await requestJson<{ data: RiceEvent }>(`${BACKEND_BASE}/api/events/${encodeURIComponent(data.id)}`, { headers: data.token ? { Authorization: `Bearer ${data.token}` } : undefined })).data)
export type EventDraftInput = { organizer_contact?: string; attachment_ids?: string[]; node_id: string; title: string; description: string; location: string; application_deadline: string; starts_at: string; ends_at: string; fee_amount: number; capacity: number; client_request_id: string }
export type SaveEventInput = { token: string; id?: string; editing?: boolean; status: 'draft' | 'open'; fields: EventDraftInput }
function sameEventContent(event: RiceEvent, fields: EventDraftInput) {
  return event.node.id === fields.node_id &&
    event.title === fields.title.trim() && event.description === fields.description.trim() && event.location === fields.location.trim() &&
    (event.organizer_contact ?? '') === (fields.organizer_contact ?? '').trim() &&
    event.fee_amount === fields.fee_amount && event.capacity === fields.capacity &&
    (['application_deadline', 'starts_at', 'ends_at'] as const).every((key) => Date.parse(event[key]) === Date.parse(fields[key])) &&
    (fields.attachment_ids === undefined || JSON.stringify((event.attachments ?? []).map((image) => image.id)) === JSON.stringify(fields.attachment_ids))
}

export async function saveEventRequest(data: SaveEventInput) {
  const headers = { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }
  const base = `${BACKEND_BASE}/api/events`
  if (data.editing) {
    if (!data.id) throw new Error('未找到要编辑的活动，请重新打开详情页。')
    const event = (await requestJson<{ data: RiceEvent }>(`${base}/${encodeURIComponent(data.id)}`, { headers })).data
    if (!event.allowed_actions.includes('edit')) throw new Error('此活动目前不能编辑。')
    if (event.status !== 'cancelled' && sameEventContent(event, data.fields)) return event
    return (await requestJson<{ data: RiceEvent }>(`${base}/${encodeURIComponent(data.id)}`, { method: 'PATCH', headers, body: JSON.stringify(data.fields) })).data
  }
  // Always obtain a recoverable draft first. Reusing its request key can return
  // the prior record after a lost response, with content that needs updating.
  let event = (await requestJson<{ data: RiceEvent }>(data.id ? `${base}/${encodeURIComponent(data.id)}` : base, data.id
    ? { headers }
    : { method: 'POST', headers, body: JSON.stringify({ ...data.fields, status: 'draft' }) })).data
  const same = sameEventContent(event, data.fields)
  if (event.status !== 'draft') {
    if (data.status === 'open' && event.status !== 'cancelled' && same) return event
    throw new Error('上次提交的活动已发布。请前往活动详情编辑。')
  }
  if (!same) event = (await requestJson<{ data: RiceEvent }>(`${base}/${encodeURIComponent(event.id)}`, { method: 'PATCH', headers, body: JSON.stringify(data.fields) })).data
  if (data.status === 'open') return (await requestJson<{ data: RiceEvent }>(`${base}/${encodeURIComponent(event.id)}/publish`, { method: 'POST', headers })).data
  return event
}
export const saveEvent = createServerFn({ method: 'POST' }).validator((data: SaveEventInput) => data).handler(({ data }) => saveEventRequest(data))
export type EventActionInput = { token: string; id: string; action: 'apply' | 'approve' | 'reject' | 'remove' | 'withdraw' | 'finish' | 'cancel'; applicationId?: string; reason?: string; contact?: string }
export async function eventActionRequest(data: EventActionInput) {
  if (data.action === 'withdraw' && !data.applicationId) throw new Error('未找到要撤销的申请，请重新打开活动详情。')
  const suffix = data.action === 'apply' ? 'applications' : data.applicationId ? `applications/${encodeURIComponent(data.applicationId)}/${data.action}` : data.action
  return (await requestJson<{ data: RiceEvent }>(`${BACKEND_BASE}/api/events/${encodeURIComponent(data.id)}/${suffix}`, { method: 'POST', headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: data.reason, contact: data.contact }) })).data
}
export const eventAction = createServerFn({ method: 'POST' }).validator((data: EventActionInput) => data).handler(({ data }) => eventActionRequest(data))
