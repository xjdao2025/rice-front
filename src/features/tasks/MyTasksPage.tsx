import { LoginLink } from '../session/LoginLink'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LoadingState } from '~/components/LoadingState'
import { useTimeBoundary } from '~/components/useTimeBoundary'
import { useStoredSession } from '../session/session'
import { TaskCard } from './TaskCard'
import { myTaskGroup, taskStatusLabel, type TaskGroup as Group, type RiceTask } from './types'
import type { MyTasksInitialData } from '~/routes/me.tasks'

export function MyTasksPage({ initialData = null, initialError = '', loaderToken }: { initialData?: MyTasksInitialData | null; initialError?: string; loaderToken?: string | null }) {
  const { session, isReady } = useStoredSession()
  const router = useRouter()
  const [group, setGroup] = useState<Group | 'all'>('all')
  useEffect(() => { if (isReady && session && loaderToken === null) void router.invalidate({ filter: (match) => match.routeId === '/me/tasks' }) }, [isReady, session?.token, loaderToken, router])
  useEffect(() => { setGroup('all') }, [session?.user.id])
  const tasks = initialData && session && initialData.accountId === session.user.id && initialData.sessionToken === session.token ? initialData.tasks : null
  const now = useTimeBoundary(tasks?.map((task) => task.status === 'open' ? task.application_deadline : task.status === 'in_progress' ? task.execution_deadline : null) ?? [])
  if (isReady && !session) return <div className="page"><LoginLink className="primary-link">登录后查看我的任务</LoginLink></div>
  if (!tasks) return <div className="page business-panel list-panel"><h1>我的任务</h1>{initialError ? <p className="inline-error" role="alert">{initialError}</p> : <LoadingState label="正在加载任务…" />}</div>
  const own = (task: RiceTask) => task.creator.id === session?.user.id || task.can_manage === true
  const groupOf = (task: RiceTask) => myTaskGroup(task, own(task), now)
  const publisher = tasks.some(own)
  const options: Array<[Group | 'all', string]> = [
    ['all', '全部任务'], ['open', taskStatusLabel.open], ['applying', '申请中'],
    ['in_progress', taskStatusLabel.in_progress], ['overdue', taskStatusLabel.overdue],
    ['under_review', taskStatusLabel.under_review], ['completed', taskStatusLabel.completed],
    ['expired', taskStatusLabel.expired], ['cancelled', taskStatusLabel.cancelled],
    ['not_selected', '未入选'], ['draft', taskStatusLabel.draft],
  ]
  const visibleOptions = options.filter(([value]) => value === 'open' || value === 'draft' ? publisher : value !== 'applying' || !publisher || tasks.some((task) => groupOf(task) === 'applying'))
  const selected = visibleOptions.some(([value]) => value === group) ? group : 'all'
  const shown = selected === 'all' ? tasks : tasks.filter((task) => groupOf(task) === selected)
  return <div className="page business-panel list-panel"><div className="business-heading"><h1>我的任务</h1><select aria-label="我的任务筛选" value={selected} onChange={(event) => setGroup(event.target.value as Group | 'all')}>{visibleOptions.map(([value, label]) => <option key={value} value={value}>{label} {value === 'all' ? tasks.length : tasks.filter((task) => groupOf(task) === value).length}</option>)}</select></div>
    {initialError && <p className="inline-error" role="alert">{initialError}</p>}<section className="task-list">{shown.map((task) => <TaskCard task={!own(task) && task.my_application_status === 'appointed' && task.my_status ? { ...task, status: task.my_status } : task} compact key={task.id} />)}</section>{!initialError && shown.length === 0 && <p className="search-hint">这里还没有任务。</p>}
  </div>
}
