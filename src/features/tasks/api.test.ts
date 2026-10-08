import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildTaskListQuery, fetchTaskPage, rejectTaskApplicationRequest, taskDraftBody } from './api'

afterEach(() => vi.unstubAllGlobals())

it('maps task draft fields to Rice without sending the session token', () => {
  const body = taskDraftBody({
    token: 'rice-token', title: '修缮门楼', description: '说明', rewardAmount: 80, capacity: 3,
    applicationDeadline: null, attachmentIds: ['image-1'], clientRequestId: 'request-1',
  })

  expect(body).toMatchObject({
    title: '修缮门楼', application_deadline: null, reward_amount: 80, capacity: 3,
    attachment_ids: ['image-1'], client_request_id: 'request-1',
  })
  expect(JSON.stringify(body)).not.toContain('rice-token')
})

describe('task list query', () => {
  it('passes filtering, search and cursor pagination to Rice', () => {
    const query = new URLSearchParams(buildTaskListQuery({
      status: 'closed',
      q: '  古村门楼  ',
      sort: 'published',
      before: '3muk26isicv2p',
      limit: 12,
    }))

    expect(Object.fromEntries(query)).toEqual({
      status: 'closed',
      q: '古村门楼',
      sort: 'published',
      before: '3muk26isicv2p',
      limit: '12',
    })
  })
})

it('asks Rice to filter by real community and applicant eligibility', () => {
  expect(Object.fromEntries(new URLSearchParams(buildTaskListQuery({ nodeId: 'node-1', available: true })))).toEqual({ node_id: 'node-1', available: 'true' })
})

it('hides cancelled tasks from shared list results without losing the next page', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({
    data: [{ id: 'open', status: 'open' }, { id: 'cancelled', status: 'cancelled' }],
    meta: { next_cursor: 'next-page' },
  })))
  vi.stubGlobal('fetch', fetch)

  const page = await fetchTaskPage({ limit: 12 })
  expect(page.data.map((task) => task.id)).toEqual(['open'])
  expect(page.meta.next_cursor).toBe('next-page')

  const mine = await fetchTaskPage({ token: 'rice-token', mine: 'managed', limit: 12 })
  expect(mine.data.map((task) => task.id)).toEqual(['open', 'cancelled'])
})

it('rejects the specified application using Rice auth and keeps the returned open task and reserved reward', async () => {
  const task = {
    id: 'task-1', status: 'open', reward_status: 'reserved', reward_amount: 80,
    application_count: 1, allowed_actions: ['cancel'],
    applications: [{ id: 'application-1', status: 'not_selected' }],
  }
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: task }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)

  const result = await rejectTaskApplicationRequest({ token: 'rice-token', taskId: 'task-1', applicationId: 'application-1' })

  expect(result).toEqual(task)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, options] = fetch.mock.calls[0]
  expect(new URL(url).pathname).toBe('/api/tasks/task-1/applications/application-1/reject')
  expect(options.method).toBe('POST')
  expect(options.headers).toEqual({ Authorization: 'Bearer rice-token' })
  expect(options.body).toBeUndefined()
})
