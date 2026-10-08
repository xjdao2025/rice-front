import { createServerFn } from '@tanstack/react-start'

import { BACKEND_BASE, requestJson } from '~/lib/http'

import type { RiceTask, TaskListStatus, TaskMine } from './types'

export type TaskListInput = {
  token?: string
  mine?: TaskMine
  status?: TaskListStatus
  participantDid?: string
  creatorDid?: string
  q?: string
  nodeId?: string
  available?: boolean
  sort?: 'published'
  limit?: number
  before?: string
}

export type TaskPage = {
  data: RiceTask[]
  meta: { next_cursor: string | null }
}

const authHeaders = (token?: string) =>
  token ? { Authorization: `Bearer ${token}` } : undefined

export function buildTaskListQuery(data: TaskListInput) {
  const query = new URLSearchParams()
  if (data.nodeId) query.set('node_id', data.nodeId)
  if (data.available) query.set('available', 'true')
  if (data.mine) query.set('mine', data.mine)
  if (data.status) query.set('status', data.status)
  if (data.participantDid) query.set('participant_did', data.participantDid)
  if (data.creatorDid) query.set('creator_did', data.creatorDid)
  if (data.q?.trim()) query.set('q', data.q.trim())
  if (data.sort) query.set('sort', data.sort)
  if (data.limit) query.set('limit', String(data.limit))
  if (data.before) query.set('before', data.before)
  return query.toString()
}

export async function fetchTaskPage(data: TaskListInput) {
  const query = buildTaskListQuery(data)
  const suffix = query ? `?${query}` : ''
  const page = await requestJson<TaskPage>(`${BACKEND_BASE}/api/tasks${suffix}`, {
    headers: authHeaders(data.token),
  })
  return data.mine ? page : { ...page, data: page.data.filter((task) => task.status !== 'cancelled') }
}

export const getTasks = createServerFn({ method: 'POST' })
  .validator((data: TaskListInput) => data)
  .handler(async ({ data }) => (await fetchTaskPage(data)).data)

export const getTaskPage = createServerFn({ method: 'POST' })
  .validator((data: TaskListInput) => data)
  .handler(async ({ data }) => fetchTaskPage(data))

export const getTask = createServerFn({ method: 'POST' })
  .validator((data: { id: string; token?: string }) => data)
  .handler(async ({ data }) => {
    const body = await requestJson<{ data: RiceTask }>(`${BACKEND_BASE}/api/tasks/${data.id}`, {
      headers: authHeaders(data.token),
    })
    return body.data
  })

type TaskFields = {
  token: string
  title: string
  description: string
  applicationDeadline?: string | null
  rewardAmount: number
  capacity: number
  nodeId?: string
  requirement?: string
  executionDeadline?: string | null
  clientRequestId?: string
  attachmentIds?: string[]
  organizerContact?: string
}

export const taskDraftBody = (data: TaskFields) => ({
  title: data.title,
  description: data.description,
  application_deadline: data.applicationDeadline,
  reward_amount: data.rewardAmount,
  capacity: data.capacity,
  node_id: data.nodeId,
  requirement: data.requirement,
  execution_deadline: data.executionDeadline,
  client_request_id: data.clientRequestId,
  attachment_ids: data.attachmentIds,
  organizer_contact: data.organizerContact,
})

export const createTask = createServerFn({ method: 'POST' })
  .validator((data: TaskFields & { status: 'draft' | 'open'; applicationDeadline?: string }) => data)
  .handler(async ({ data }) => {
    const body = await requestJson<{ data: RiceTask }>(`${BACKEND_BASE}/api/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(data.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...taskDraftBody(data), status: data.status }),
    })
    return body.data
  })

export const updateTask = createServerFn({ method: 'POST' })
  .validator((data: TaskFields & { taskId: string; applicationDeadline: string | null }) => data)
  .handler(async ({ data }) => {
    const body = await requestJson<{ data: RiceTask }>(`${BACKEND_BASE}/api/tasks/${data.taskId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(data.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(taskDraftBody(data)),
    })
    return body.data
  })

const taskAction = async (token: string, taskId: string, action: 'publish' | 'cancel') => {
  const body = await requestJson<{ data: RiceTask }>(
    `${BACKEND_BASE}/api/tasks/${taskId}/${action}`,
    { method: 'POST', headers: authHeaders(token) },
  )
  return body.data
}

export const publishTask = createServerFn({ method: 'POST' })
  .validator((data: { token: string; taskId: string }) => data)
  .handler(({ data }) => taskAction(data.token, data.taskId, 'publish'))

export const cancelTask = createServerFn({ method: 'POST' })
  .validator((data: { token: string; taskId: string }) => data)
  .handler(({ data }) => taskAction(data.token, data.taskId, 'cancel'))

export const applyForTask = createServerFn({ method: 'POST' })
  .validator((data: { token: string; taskId: string; reason: string; contact: string }) => data)
  .handler(async ({ data }) => {
    const body = await requestJson<{ data: RiceTask }>(
      `${BACKEND_BASE}/api/tasks/${data.taskId}/applications`,
      {
        method: 'POST',
        headers: { ...authHeaders(data.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: data.reason, contact: data.contact }),
      },
    )
    return body.data
  })

export const appointTaskApplication = createServerFn({ method: 'POST' })
  .validator((data: {
    token: string
    taskId: string
    applicationId: string
    appointmentReason: string
  }) => data)
  .handler(async ({ data }) => {
    const body = await requestJson<{ data: RiceTask }>(
      `${BACKEND_BASE}/api/tasks/${data.taskId}/applications/${data.applicationId}/appoint`,
      {
        method: 'POST',
        headers: { ...authHeaders(data.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointment_reason: data.appointmentReason }),
      },
    )
    return body.data
  })

type RejectTaskApplicationInput = { token: string; taskId: string; applicationId: string }

export async function rejectTaskApplicationRequest(data: RejectTaskApplicationInput) {
  const body = await requestJson<{ data: RiceTask }>(
    `${BACKEND_BASE}/api/tasks/${data.taskId}/applications/${data.applicationId}/reject`,
    { method: 'POST', headers: authHeaders(data.token) },
  )
  return body.data
}

export const rejectTaskApplication = createServerFn({ method: 'POST' })
  .validator((data: RejectTaskApplicationInput) => data)
  .handler(({ data }) => rejectTaskApplicationRequest(data))

export const submitTaskResult = createServerFn({ method: 'POST' })
  .validator((data: { token: string; taskId: string; body: string }) => data)
  .handler(async ({ data }) => {
    const result = await requestJson<{ data: RiceTask }>(
      `${BACKEND_BASE}/api/tasks/${data.taskId}/submissions`,
      {
        method: 'POST',
        headers: { ...authHeaders(data.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: data.body }),
      },
    )
    return result.data
  })

const reviewTask = async (
  data: { token: string; taskId: string; submissionId: string; reason?: string },
  action: 'approve' | 'request_changes',
) => {
  const body = await requestJson<{ data: RiceTask }>(
    `${BACKEND_BASE}/api/tasks/${data.taskId}/submissions/${data.submissionId}/${action}`,
    {
      method: 'POST',
      headers: { ...authHeaders(data.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: data.reason }),
    },
  )
  return body.data
}

export const approveTaskResult = createServerFn({ method: 'POST' })
  .validator((data: { token: string; taskId: string; submissionId: string }) => data)
  .handler(({ data }) => reviewTask(data, 'approve'))

export const requestTaskChanges = createServerFn({ method: 'POST' })
  .validator((data: {
    token: string
    taskId: string
    submissionId: string
    reason: string
  }) => data)
  .handler(({ data }) => reviewTask(data, 'request_changes'))
