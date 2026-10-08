import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Link } from '@tanstack/react-router'
import { useCallback } from 'react'
import { AutoLoadMore } from '~/components/AutoLoadMore'
import { LoadingState } from '~/components/LoadingState'
import { usePagedBusinessList } from '~/components/usePagedBusinessList'
import { useStoredSession } from '../session/session'
import { getTaskPage, type TaskPage } from './api'
import { TaskCard } from './TaskCard'
import type { RiceTask } from './types'

type TasksPageProps = { nodeId?: string; initialPage?: TaskPage; refreshError?: string }
export function TasksPage(props: TasksPageProps) {
  const { session } = useStoredSession()
  return <TaskList key={`${props.nodeId ?? 'all'}:${session?.token ?? 'guest'}`} {...props} />
}

function TaskList({ nodeId, initialPage, refreshError = '' }: TasksPageProps) {
  const { session, isReady } = useStoredSession()
  const usesRoutePage = Boolean(initialPage && !nodeId)
  const loadPage = useCallback((before?: string) => getTaskPage({ data: {
    token: session?.token,
    nodeId, sort: 'published', limit: 12, before,
  } }), [session?.token, nodeId])
  const { rows: tasks, cursor: nextCursor, loading, error, visibleError, more } = usePagedBusinessList<RiceTask>({
    initialPage, useRoutePage: usesRoutePage, isReady,
    disabled: false,
    refreshError, loadPage,
  })
  return <div className="page task-page">
    <div className="business-heading"><h1>{nodeId ? '节点任务' : '全部任务'}</h1>{session && !nodeId && <Link to="/me/tasks">我的任务</Link>}</div>
    {visibleError && <p className="inline-error" role="alert">{visibleError}</p>}{loading && (tasks.length ? <p className="refresh-status" role="status">正在加载任务…</p> : <LoadingState label="正在加载任务…" />)}<section className="task-list" aria-busy={loading}>{tasks.map((task) => <TaskCard task={task} key={task.id} />)}</section>
    {!loading && !visibleError && !tasks.length && <EmptyState isCompact title="暂时没有任务。" />}{nextCursor && <AutoLoadMore key={`${nodeId}:${session?.user.id}`} cursor={nextCursor} loading={loading || !isReady} failed={!!error} onLoadMore={more} />}
  </div>
}
