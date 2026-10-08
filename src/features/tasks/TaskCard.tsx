import { ImageGroup } from '~/components/ContentImages'
import { attachmentImages } from '~/lib/attachments'
import { Sprout } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTimeBoundary } from '~/components/useTimeBoundary'
import { ContentCardHeader } from '~/components/ContentCardHeader'
import { formatTimestamp } from '~/lib/format'
import { pastTaskApplicationDeadline, pastTaskExecutionDeadline, taskDisplayStatus, type RiceTask } from './types'

export function TaskCard({ task, compact = false }: { task: RiceTask; compact?: boolean }) {
  const navigate = useNavigate()
  const now = useTimeBoundary(task.status === 'open' ? [task.application_deadline] : task.status === 'in_progress' ? [task.execution_deadline] : [])
  const displayStatus = pastTaskApplicationDeadline(task, now) ? 'expired' : pastTaskExecutionDeadline(task, now) ? 'overdue' : task.status
  const name = task.node?.name || task.creator.nickname || task.creator.handle
  return <article className={`content-card task-card business-card ${compact ? 'compact-task-card' : ''}`}>
    {!compact && <ContentCardHeader name={name} avatarUrl={task.node ? task.node.logo?.url : task.creator.avatar?.url} onAuthorClick={task.node ? () => { void navigate({ to: '/nodes/$nodeId', params: { nodeId: task.node!.id } }) } : undefined} timestamp={`${formatTimestamp(task.published_at ?? task.inserted_at)} · 发布`} />}
    <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="business-card-body">
    <h2>{task.title}</h2>{!compact && <p>{task.description}</p>}
    </Link>
    {!compact && <ImageGroup images={attachmentImages(task.attachments)} className="post-image-grid" />}
    <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="business-card-body">
    <footer className="content-card-actions task-card-actions"><span className={`task-status status-${displayStatus}`}>{taskDisplayStatus(task, now)}</span><strong className="rice-amount" aria-label={`${task.reward_amount} 稻米${(task.capacity ?? 1) > 1 ? ' / 人' : ''}`}><Sprout size={21} aria-hidden="true" />{task.reward_amount}{(task.capacity ?? 1) > 1 && ' / 人'}</strong></footer>
    </Link></article>
}
