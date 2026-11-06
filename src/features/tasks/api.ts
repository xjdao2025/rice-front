import { createServerFn } from '@tanstack/react-start'

import { backend, backendData, searchParams, withQuery } from '~/lib/http'
import { withAvatars } from '../social/api'
import { array, boolean, credential, id, integer, money, nullable, object, oneOf, optional, pageFields, text } from '~/lib/validation'

const taskRef = { token: credential, taskId: id }
const applicationRef = { ...taskRef, applicationId: id }
const taskFields = {
  token: credential, title: text(128, 1), description: text(4000, 1),
  applicationDeadline: optional(nullable(text(64))), fundingSource: optional(oneOf(['node', 'personal'])),
  rewardAmount: money, capacity: integer(1, 1000), nodeId: optional(text(256)), requirement: optional(text(4000)),
  executionDeadline: optional(nullable(text(64))), clientRequestId: optional(text(128)),
  attachmentIds: optional(array(id, 9)), organizerContact: optional(text(256)),
}

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
  return withAvatars(page)
}

export const getTaskPage = createServerFn({ method: 'POST' })
  .validator(object({ token: optional(credential), mine: optional(oneOf(['assigned', 'created', 'applied', 'managed'])),
    status: optional(oneOf(['draft', 'open', 'in_progress', 'overdue', 'under_review', 'completed', 'expired', 'cancelled', 'closed'])),
    participantDid: optional(id), creatorDid: optional(id), q: optional(text(256)), nodeId: optional(id),
    available: optional(boolean), sort: optional(oneOf(['published'])), ...pageFields }))
  .handler(async ({ data }) => fetchTaskPage(data))

export const getTask = createServerFn({ method: 'POST' })
  .validator(object({ id, token: optional(credential) }))
  .handler(async ({ data }) => withAvatars(await backendData<RiceTask>(taskPath(data.id), { token: data.token })))

type TaskFields = {
  token: string
  title: string
  description: string
  applicationDeadline?: string | null
  fundingSource?: 'node' | 'personal'
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
  funding_source: data.fundingSource,
  capacity: data.capacity,
  node_id: data.nodeId || undefined,
  requirement: data.requirement,
  execution_deadline: data.executionDeadline,
  client_request_id: data.clientRequestId,
  attachment_ids: data.attachmentIds,
  organizer_contact: data.organizerContact,
})

export const taskDraftInput = object({ ...taskFields, status: oneOf(['draft', 'open']) })
export const createTask = createServerFn({ method: 'POST' })
  .validator(taskDraftInput)
  .handler(async ({ data }) => backendData<RiceTask>('/api/tasks', {
    method: 'POST', token: data.token, json: { ...taskDraftBody(data), status: data.status },
  }))

const send = async (token: string, method: 'POST' | 'PATCH' | 'DELETE', segments: string[], payload?: object) =>
  withAvatars(await backendData<RiceTask>(taskPath(...segments), { method, token, json: payload }))

export const updateTask = createServerFn({ method: 'POST' })
  .validator(object({ ...taskFields, taskId: id, applicationDeadline: nullable(text(64)) }))
  .handler(({ data }) => send(data.token, 'PATCH', [data.taskId], taskDraftBody(data)))

type TaskRef = { token: string; taskId: string }
type ApplicationRef = TaskRef & { applicationId: string }

export const publishTask = createServerFn({ method: 'POST' })
  .validator(object(taskRef))
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'publish']))

export const cancelTask = createServerFn({ method: 'POST' })
  .validator(object(taskRef))
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'cancel']))

/** 多人任务提前结束：已验收的保留，其余承接者撤销指派，没发出去的稻米退回节点。 */
export const closeTask = createServerFn({ method: 'POST' })
  .validator(object(taskRef))
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'close']))

/** 负责人确认完成：还在承接的人（含待验收）都记为完成并发稻米，空着的名额退回。 */
export const completeTask = createServerFn({ method: 'POST' })
  .validator(object(taskRef))
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'complete']))

/** 删除已结束的任务：列表和详情里不再出现，稻米记录保留。 */
export const deleteTask = createServerFn({ method: 'POST' })
  .validator(object(taskRef))
  .handler(({ data }) => send(data.token, 'DELETE', [data.taskId]))

/** 多人任务撤销一个人的指派：名额让出来，奖励不发。 */
export const releaseTaskAssignee = createServerFn({ method: 'POST' })
  .validator(object({ ...applicationRef, reason: text(512) }))
  .handler(({ data }) =>
    send(data.token, 'POST', [data.taskId, 'applications', data.applicationId, 'release'], { reason: data.reason }))

export const applyForTask = createServerFn({ method: 'POST' })
  .validator(object({ ...taskRef, reason: text(512), contact: text(256, 1) }))
  .handler(({ data }) =>
    send(data.token, 'POST', [data.taskId, 'applications'], { reason: data.reason, contact: data.contact }))

export const appointTaskApplication = createServerFn({ method: 'POST' })
  .validator(object({ ...applicationRef, appointmentReason: text(512) }))
  .handler(({ data }) =>
    send(data.token, 'POST', [data.taskId, 'applications', data.applicationId, 'appoint'], {
      appointment_reason: data.appointmentReason,
    }))

export const rejectTaskApplicationRequest = (data: ApplicationRef) =>
  send(data.token, 'POST', [data.taskId, 'applications', data.applicationId, 'reject'])

export const rejectTaskApplication = createServerFn({ method: 'POST' })
  .validator(object(applicationRef))
  .handler(({ data }) => rejectTaskApplicationRequest(data))

export const submitTaskResult = createServerFn({ method: 'POST' })
  .validator(object({ ...taskRef, body: text(8000, 1) }))
  .handler(({ data }) => send(data.token, 'POST', [data.taskId, 'submissions'], { body: data.body }))

type SubmissionReview = TaskRef & { submissionId: string; reason?: string }

const reviewTask = (data: SubmissionReview, action: 'approve' | 'request_changes') =>
  send(data.token, 'POST', [data.taskId, 'submissions', data.submissionId, action], { reason: data.reason })

export const approveTaskResult = createServerFn({ method: 'POST' })
  .validator(object({ ...taskRef, submissionId: id, reason: optional(text(512)) }))
  .handler(({ data }) => reviewTask(data, 'approve'))

export const requestTaskChanges = createServerFn({ method: 'POST' })
  .validator(object({ ...taskRef, submissionId: id, reason: text(512, 1) }))
  .handler(({ data }) => reviewTask(data, 'request_changes'))
