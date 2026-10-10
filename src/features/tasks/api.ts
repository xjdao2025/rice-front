import { createServerFn } from '@tanstack/react-start'

import { backend, backendData, searchParams, withQuery } from '~/lib/http'
import { withAvatars } from '../social/api'

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

export type TaskPage = { data: RiceTask[]; meta: { next_cursor: string | null } }

/** 任务接口的路径：每一段都编码，id 里带 `../` 也越不出 /api/tasks。 */
const taskPath = (...segments: string[]) => ['/api/tasks', ...segments.map(encodeURIComponent)].join('/')

const taskListParams = (data: TaskListInput) => ({
  node_id: data.nodeId,
  available: data.available && 'true',
  mine: data.mine,
  status: data.status,
  participant_did: data.participantDid,
  creator_did: data.creatorDid,
  q: data.q?.trim(),
  sort: data.sort,
  limit: data.limit || undefined,
  before: data.before,
})

export const buildTaskListQuery = (data: TaskListInput) => searchParams(taskListParams(data)).toString()

export async function fetchTaskPage(data: TaskListInput) {
  const page = await backend<TaskPage>(withQuery('/api/tasks', taskListParams(data)), { token: data.token })
  return withAvatars(data.mine ? page : { ...page, data: page.data.filter((task) => task.status !== 'cancelled') })
}

export const getTaskPage = createServerFn({ method: 'POST' })
  .validator((data: TaskListInput) => data)
  .handler(async ({ data }) => fetchTaskPage(data))

export const getTask = createServerFn({ method: 'POST' })
  .validator((data: { id: string; token?: string }) => data)
  .handler(async ({ data }) => withAvatars(await backendData<RiceTask>(taskPath(data.id), { token: data.token })))

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
  node_id: data.nodeId || undefined,
  requirement: data.requirement,
  execution_deadline: data.executionDeadline,
  client_request_id: data.clientRequestId,
  attachment_ids: data.attachmentIds,
  organizer_contact: data.organizerContact,
})

export const createTask = createServerFn({ method: 'POST' })
  .validator((data: TaskFields & { status: 'draft' | 'open'; applicationDeadline?: string }) => data)
  .handler(async ({ data }) => backendData<RiceTask>('/api/tasks', {
    method: 'POST', token: data.token, json: { ...taskDraftBody(data), status: data.status },
  }))

const send = async (token: string, method: 'POST' | 'PATCH', segments: string[], payload?: object) =>
  withAvatars(await backendData<RiceTask>(taskPath(...segments), { method, token, json: payload }))

export const updateTask = createServerFn({ method: 'POST' })
  .validator((data: TaskFields & { taskId: string; applicationDeadline: string | null }) => data)
  .handler(({ data }) => send(data.token, 'PATCH', [data.taskId], taskDraftBody(data)))

type TaskRef = { token: string; taskId: string }
type ApplicationRef = TaskRef & { applicationId: string }

export const publishTask = createServerFn({ method: 'POST' })
  .validator((data: TaskRef) => data)
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'publish']))

export const cancelTask = createServerFn({ method: 'POST' })
  .validator((data: TaskRef) => data)
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'cancel']))

/** 多人任务提前结束：已验收的保留，其余承接者撤销指派，没发出去的稻米退回节点。 */
export const closeTask = createServerFn({ method: 'POST' })
  .validator((data: TaskRef) => data)
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'close']))

/** 多人任务撤销一个人的指派：名额让出来，奖励不发。 */
export const releaseTaskAssignee = createServerFn({ method: 'POST' })
  .validator((data: ApplicationRef & { reason: string }) => data)
  .handler(({ data }) =>
    send(data.token, 'POST', [data.taskId, 'applications', data.applicationId, 'release'], { reason: data.reason }))

export const applyForTask = createServerFn({ method: 'POST' })
  .validator((data: TaskRef & { reason: string; contact: string }) => data)
  .handler(({ data }) =>
    send(data.token, 'POST', [data.taskId, 'applications'], { reason: data.reason, contact: data.contact }))

export const appointTaskApplication = createServerFn({ method: 'POST' })
  .validator((data: ApplicationRef & { appointmentReason: string }) => data)
  .handler(({ data }) =>
    send(data.token, 'POST', [data.taskId, 'applications', data.applicationId, 'appoint'], {
      appointment_reason: data.appointmentReason,
    }))

export const rejectTaskApplicationRequest = (data: ApplicationRef) =>
  send(data.token, 'POST', [data.taskId, 'applications', data.applicationId, 'reject'])

export const rejectTaskApplication = createServerFn({ method: 'POST' })
  .validator((data: ApplicationRef) => data)
  .handler(({ data }) => rejectTaskApplicationRequest(data))

export const submitTaskResult = createServerFn({ method: 'POST' })
  .validator((data: TaskRef & { body: string }) => data)
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'submissions'], { body: data.body }))

type SubmissionReview = TaskRef & { submissionId: string; reason?: string }

const reviewTask = (data: SubmissionReview, action: 'approve' | 'request_changes') =>
  send(data.token, 'POST', [data.taskId, 'submissions', data.submissionId, action], { reason: data.reason })

export const approveTaskResult = createServerFn({ method: 'POST' })
  .validator((data: SubmissionReview) => data)
  .handler(({ data }) => reviewTask(data, 'approve'))

export const requestTaskChanges = createServerFn({ method: 'POST' })
  .validator((data: SubmissionReview & { reason: string }) => data)
  .handler(({ data }) => reviewTask(data, 'request_changes'))
