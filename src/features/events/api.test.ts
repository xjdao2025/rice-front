import { afterEach, expect, it, vi } from 'vitest'
import { applicationStatusLabel, eventAcceptsApplications, eventActionRequest, eventDisplayStatus, eventSettlementAmount, fetchEventPage, saveEventRequest, type EventApplication, type EventDraftInput } from './api'
afterEach(() => vi.unstubAllGlobals())
it('uses Rice auth and preserves event ownership, participation and paging filters', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { next_cursor: null } }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  await fetchEventPage({ token: 'rice-token', q: '修理', nodeId: 'node-1', mine: 'applied', participantDid: 'did:plc:lin', creatorDid: 'did:plc:admin', before: 'cursor-1' })
  const [url, options] = fetch.mock.calls[0]
  expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ q: '修理', node_id: 'node-1', mine: 'applied', participant_did: 'did:plc:lin', creator_did: 'did:plc:admin', before: 'cursor-1' })
  expect(options.headers).toEqual({ Authorization: 'Bearer rice-token' })
})

const fields: EventDraftInput = { node_id: 'node', title: '散步', description: '一起散步', location: '社区', application_deadline: '2026-10-01T01:00:00Z', starts_at: '2026-10-01T02:00:00Z', ends_at: '2026-10-01T03:00:00Z', capacity: 30, fee_amount: 20, client_request_id: 'same-key', attachment_ids: ['old-image'] }
const attachment = (id: string) => ({ id, kind: 'image', filename: `${id}.png`, content_type: 'image/png', byte_size: 10, url: `/api/attachments/${id}` })
const event = { ...fields, id: 'event-1', status: 'draft', node: { id: 'node' }, attachments: [attachment('old-image')] }
const response = (data: object) => new Response(JSON.stringify({ data }), { status: 200 })

it('shows the actual activity phase even when cached open status has not advanced yet', () => {
  const times = { ...fields, status: 'open' as const, approved_count: 0 }
  expect(eventDisplayStatus(times, Date.parse(fields.application_deadline) - 1)).toBe('报名中')
  expect(eventDisplayStatus(times, Date.parse(fields.application_deadline))).toBe('报名已截止')
  expect(eventDisplayStatus(times, Date.parse(fields.starts_at))).toBe('已开始')
  expect(eventDisplayStatus(times, Date.parse(fields.ends_at))).toBe('等组织者确认结束')
  expect(eventDisplayStatus({ ...times, status: 'cancelled' }, Date.parse(fields.ends_at))).toBe('已取消')
  expect(eventAcceptsApplications(times, Date.parse(fields.application_deadline))).toBe(false)
  expect(eventDisplayStatus({ ...times, approved_count: fields.capacity }, Date.parse(fields.starts_at))).toBe('已开始')
})

it('previews only approved participants with actual reserved rice amounts', () => {
  const application = (status: EventApplication['status'], payment_status: EventApplication['payment_status'], fee_amount?: number): EventApplication => ({ id: 'application', status, payment_status, fee_amount, reason: '', user: { id: 'participant', did: 'did:plc:participant', handle: 'participant', nickname: '参与者', bio: null, avatar: null, node_member: false }, inserted_at: '', allowed_actions: [] })
  const applications = [application('approved', 'reserved', 12), application('approved', 'reserved', 8), application('pending', 'reserved', 50), application('removed', 'refunded', 100)]
  expect(eventSettlementAmount({ approved_count: 2, applications })).toBe(20)
  expect(eventSettlementAmount({ approved_count: 0, applications: [] })).toBe(0)
  expect(eventSettlementAmount({ approved_count: 3, applications })).toBeNull()
  expect(eventSettlementAmount({ approved_count: 1, applications: [application('approved', 'reserved')] })).toBeNull()
  expect(eventSettlementAmount({ approved_count: 1, applications: [application('approved', 'settled', 12)] })).toBeNull()
  expect(applicationStatusLabel.pending).toBe('已报名，等组织者确认')
})

it('accepts new applications only while approved participants leave room, and reopens when a place is released', () => {
  const now = Date.parse(fields.application_deadline) - 1
  const open = { ...fields, status: 'open' as const, capacity: 1, approved_count: 0, application_count: 3 }
  expect(eventAcceptsApplications(open, now)).toBe(true)
  expect(eventDisplayStatus(open, now)).toBe('报名中')
  const full = { ...open, approved_count: 1 }
  expect(eventAcceptsApplications(full, now)).toBe(false)
  expect(eventDisplayStatus(full, now)).toBe('已满')
  expect(eventAcceptsApplications({ ...full, approved_count: 0 }, now)).toBe(true)
  expect(eventDisplayStatus({ ...full, approved_count: 0 }, now)).toBe('报名中')
  expect(eventAcceptsApplications({ ...open, status: 'cancelled' }, now)).toBe(false)
})

it('withdraws the specified application with Rice auth and uses the returned status and permissions', async () => {
  const withdrawn = { id: 'application-1', status: 'withdrawn', payment_status: 'refunded', allowed_actions: [] }
  const updated = { ...event, status: 'open', my_application: withdrawn, applications: [withdrawn], allowed_actions: [] }
  const fetch = vi.fn().mockResolvedValue(response(updated))
  vi.stubGlobal('fetch', fetch)
  const result = await eventActionRequest({ token: 'rice-token', id: 'event-1', action: 'withdraw', applicationId: 'application-1' })
  const [url, options] = fetch.mock.calls[0]
  expect(new URL(url).pathname).toBe('/api/events/event-1/applications/application-1/withdraw')
  expect(options.method).toBe('POST')
  expect(options.headers.Authorization).toBe('Bearer rice-token')
  expect(result).toEqual(updated)
  expect(applicationStatusLabel[result.my_application!.status]).toBe('已撤销')
})

it('does not send a withdrawal request without an application id', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(eventActionRequest({ token: 'rice-token', id: 'event-1', action: 'withdraw' })).rejects.toThrow('未找到要撤销的申请')
  expect(fetch).not.toHaveBeenCalled()
})

it('surfaces a concurrent approval conflict without retrying or reporting a refund', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: { detail: '当前状态不允许此操作' } }), { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await expect(eventActionRequest({ token: 'rice-token', id: 'event-1', action: 'withdraw', applicationId: 'application-1' })).rejects.toThrow('当前状态不允许此操作')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('recovers a published draft after a lost response without patching or publishing it twice', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ ...event, status: 'open' }))
  vi.stubGlobal('fetch', fetch)
  const result = await saveEventRequest({ token: 'rice-token', id: 'event-1', status: 'open', fields })
  expect(result.status).toBe('open')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][1].method).toBeUndefined()
})

it('edits the requested published activity with one PATCH and keeps ordered images', async () => {
  const updated = { ...event, status: 'open', allowed_actions: ['edit'], title: '新的散步', attachments: [attachment('new-second'), attachment('new-first')] }
  const fetch = vi.fn().mockResolvedValueOnce(response({ ...event, status: 'open', allowed_actions: ['edit'] })).mockResolvedValueOnce(response(updated))
  vi.stubGlobal('fetch', fetch)
  const changed = { ...fields, title: '新的散步', attachment_ids: ['new-second', 'new-first'] }
  const result = await saveEventRequest({ token: 'rice-token', id: 'event-1', editing: true, status: 'open', fields: changed })
  expect(result.attachments?.map((image) => image.id)).toEqual(changed.attachment_ids)
  expect(fetch.mock.calls.map(([url, options]) => [new URL(url).pathname, options.method ?? 'GET'])).toEqual([
    ['/api/events/event-1', 'GET'], ['/api/events/event-1', 'PATCH'],
  ])
  expect(JSON.parse(String(fetch.mock.calls[1][1].body)).attachment_ids).toEqual(changed.attachment_ids)
})

it('PATCHes an unchanged cancelled activity so the server can reopen it', async () => {
  const closed = { ...event, status: 'cancelled', allowed_actions: ['edit'] }
  const fetch = vi.fn().mockResolvedValueOnce(response(closed)).mockResolvedValueOnce(response({ ...closed, status: 'open', round: 2 }))
  vi.stubGlobal('fetch', fetch)
  const result = await saveEventRequest({ token: 'rice-token', id: 'event-1', editing: true, status: 'open', fields })
  expect(result.status).toBe('open')
  expect(fetch.mock.calls.map(([url, options]) => [new URL(url).pathname, options.method ?? 'GET'])).toEqual([
    ['/api/events/event-1', 'GET'], ['/api/events/event-1', 'PATCH'],
  ])
})

it.each(['draft', 'open'] as const)('recovers a lost draft creation response and saves corrected times and images before %s', async (status) => {
  let saved: typeof event | undefined
  let published = 0
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && !_url.endsWith('/publish')) {
      if (!saved) { saved = { ...event }; throw new Error('lost draft response') }
      return response(saved!)
    }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      saved = { ...saved!, ...body, attachments: body.attachment_ids.map(attachment) }
      return response(saved!)
    }
    if (_url.endsWith('/publish')) { published++; saved = { ...saved!, status: 'open' }; return response(saved) }
    throw new Error('unexpected request')
  })
  vi.stubGlobal('fetch', fetch)
  await expect(saveEventRequest({ token: 'rice-token', status: 'draft', fields })).rejects.toThrow()
  const edited = { ...fields, attachment_ids: ['new-second', 'new-first'], application_deadline: '2026-10-02T01:00:00Z', starts_at: '2026-10-02T02:00:00Z', ends_at: '2026-10-02T04:00:00Z' }
  const result = await saveEventRequest({ token: 'rice-token', status, fields: edited })
  expect(result.status).toBe(status)
  expect(result.attachments?.map((image) => image.id)).toEqual(edited.attachment_ids)
  expect([result.application_deadline, result.starts_at, result.ends_at]).toEqual([edited.application_deadline, edited.starts_at, edited.ends_at])
  expect(published).toBe(status === 'open' ? 1 : 0)
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).status).toBe('draft')
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).client_request_id).toBe('same-key')
})

it('recovers a lost publish response by the same key without publishing twice', async () => {
  let published = 0
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/publish')) { published++; throw new Error('lost publish response') }
    expect(init?.method).toBe('POST')
    return response({ ...event, status: published ? 'open' : 'draft' })
  })
  vi.stubGlobal('fetch', fetch)
  await expect(saveEventRequest({ token: 'rice-token', status: 'open', fields })).rejects.toThrow()
  const recovered = await saveEventRequest({ token: 'rice-token', status: 'open', fields })
  expect(recovered.status).toBe('open')
  expect(published).toBe(1)
})

it.each([undefined, 'event-1'])('rejects changed images when a retry returns an already published event (id=%s)', async (id) => {
  const fetch = vi.fn().mockResolvedValue(response({ ...event, status: 'open' }))
  vi.stubGlobal('fetch', fetch)
  await expect(saveEventRequest({ token: 'rice-token', id, status: 'open', fields: { ...fields, attachment_ids: ['different-image'] } })).rejects.toThrow('上次提交的活动已发布')
  expect(fetch).toHaveBeenCalledTimes(1)
})
