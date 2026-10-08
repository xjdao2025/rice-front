import type { RicePublicUser, RiceAttachment, HistorySnapshot } from '~/lib/models'

export type TaskStatus =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'overdue'
  | 'under_review'
  | 'completed'
  | 'expired'
  | 'cancelled'
export type TaskListStatus = TaskStatus | 'closed'
export type TaskMine = 'assigned' | 'created' | 'applied' | 'managed'

export type TaskApplication = {
  id: string
  round?: number
  reason: string
  contact?: string | null
  status: 'pending' | 'appointed' | 'not_selected' | 'cancelled' | 'expired'
  user: RicePublicUser
  inserted_at: string
}

export type TaskEvent = {
  id: string
  action?: string
  from_status: TaskStatus | null
  to_status: TaskStatus
  detail: string | null
  actor: RicePublicUser | null
  inserted_at: string
  before?: HistorySnapshot | null
  after?: HistorySnapshot | null
}

export type TaskSubmission = {
  id: string
  round?: number
  body: string
  status: 'pending' | 'approved' | 'changes_requested'
  review_reason: string | null
  user: RicePublicUser
  inserted_at: string
}

export type RiceTask = {
  attachments?: RiceAttachment[]
  id: string
  round?: number
  title: string
  description: string
  organizer_contact?: string | null
  node?: { id: string; name: string; logo: RiceAttachment | null }
  requirement?: string
  execution_deadline?: string | null
  application_closed?: boolean
  overdue?: boolean
  status: TaskStatus
  creator: RicePublicUser
  assignee: RicePublicUser | null
  assignees?: RicePublicUser[]
  application_deadline: string | null
  appointed_at: string | null
  appointment_reason: string | null
  reward_amount: number
  capacity?: number
  appointed_count?: number
  total_reward_amount?: number
  my_status?: TaskStatus | null
  funding_node_id?: string | null
  can_manage?: boolean
  reward_status: 'none' | 'reserved' | 'settled' | 'refunded'
  application_count: number
  my_application_status: TaskApplication['status'] | null
  my_application?: TaskApplication | null
  allowed_actions: Array<
    | 'publish'
    | 'apply'
    | 'appoint'
    | 'reject_application'
    | 'cancel'
    | 'submit_result'
    | 'approve_result'
    | 'request_changes'
    | 'edit'
  >
  applications: TaskApplication[] | null
  past_applications?: TaskApplication[] | null
  submissions: TaskSubmission[] | null
  past_submissions?: TaskSubmission[] | null
  events: TaskEvent[] | null
  published_at: string | null
  inserted_at: string
  updated_at: string
}

export const taskStatusLabel: Record<TaskStatus, string> = {
  draft: '草稿',
  open: '招募中',
  in_progress: '进行中',
  overdue: '已超时',
  under_review: '待验收',
  completed: '已完成',
  expired: '已失效',
  cancelled: '已取消',
}

type DeadlineTask = Pick<RiceTask, 'status' | 'application_deadline'> & Partial<Pick<RiceTask, 'appointed_count' | 'assignees' | 'assignee'>>

export function pastTaskApplicationDeadline(task: DeadlineTask, now: number) {
  const appointedCount = task.appointed_count ?? task.assignees?.length ?? (task.assignee ? 1 : 0)
  return task.status === 'open' && appointedCount === 0 && !!task.application_deadline && Date.parse(task.application_deadline) <= now
}

export function pastTaskExecutionDeadline(task: Pick<RiceTask, 'status' | 'execution_deadline'>, now: number) {
  return task.status === 'in_progress' && !!task.execution_deadline && Date.parse(task.execution_deadline) <= now
}

export function taskDisplayStatus(task: Pick<RiceTask, 'status' | 'application_closed' | 'application_deadline' | 'execution_deadline'> & Partial<Pick<RiceTask, 'appointed_count' | 'assignees' | 'assignee'>>, now: number) {
  if (pastTaskApplicationDeadline(task, now)) return taskStatusLabel.expired
  if (pastTaskExecutionDeadline(task, now)) return taskStatusLabel.overdue
  if (task.status === 'open' && task.application_closed) return '申请已截止'
  return taskStatusLabel[task.status]
}

export const taskApplicationStatusLabel: Record<TaskApplication['status'], string> = {
  pending: '申请中',
  appointed: '已入选',
  not_selected: '未入选',
  cancelled: '任务已取消',
  expired: '任务已失效',
}

export function taskEventLabel(event: TaskEvent) {
  if (event.action === 'edited') return '编辑任务'
  if (event.from_status === event.to_status) return '更新任务进展'
  switch (event.to_status) {
    case 'draft': return '创建任务草稿'
    case 'open': return '发布任务'
    case 'in_progress': return event.from_status === 'under_review' ? '退回修改' : '选定承接者'
    case 'overdue': return '交付超时'
    case 'under_review': return '提交成果'
    case 'completed': return '验收通过，任务完成'
    case 'cancelled': return '任务取消'
    case 'expired': return '任务已失效'
  }
}

export type TaskGroup = TaskStatus | 'applying' | 'not_selected'
export function myTaskGroup(task: RiceTask, isPublisher: boolean, now = Date.now()): TaskGroup {
  if (!isPublisher && task.my_application_status === 'not_selected') return 'not_selected'
  if (!isPublisher && task.my_application_status === 'appointed' && task.my_status) task = { ...task, status: task.my_status }
  if (pastTaskApplicationDeadline(task, now)) return 'expired'
  if (!isPublisher && task.my_application_status === 'pending' && !['completed', 'expired', 'cancelled'].includes(task.status)) return 'applying'
  if (pastTaskExecutionDeadline(task, now)) return 'overdue'
  if (!isPublisher && task.status === 'open') return 'applying'
  return task.status
}
