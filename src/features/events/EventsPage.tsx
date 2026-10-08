import { LoginLink } from '../session/LoginLink'
import { ImageGroup } from '~/components/ContentImages'
import { attachmentImages } from '~/lib/attachments'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Link, useNavigate } from '@tanstack/react-router'
import { Sprout } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTimeBoundary } from '~/components/useTimeBoundary'
import { ContentCardHeader } from '~/components/ContentCardHeader'
import { AutoLoadMore } from '~/components/AutoLoadMore'
import { LoadingState } from '~/components/LoadingState'
import { usePagedBusinessList } from '~/components/usePagedBusinessList'
import { formatTimestamp } from '~/lib/format'
import { useStoredSession } from '../session/session'
import { eventDisplayStatus, getEvents, type RiceEvent, type EventPage } from './api'

export function EventCard({ event }: { event: RiceEvent }) {
  const navigate = useNavigate()
  const now = useTimeBoundary(['open', 'in_progress'].includes(event.status) ? [event.application_deadline, event.starts_at, event.ends_at] : [])
  return <article className="content-card task-card business-card">
    <ContentCardHeader name={event.node.name} avatarUrl={event.node.logo?.url} onAuthorClick={() => { void navigate({ to: '/nodes/$nodeId', params: { nodeId: event.node.id } }) }} timestamp={`${formatTimestamp(event.published_at ?? event.inserted_at)} · 发布`} />
    <Link to="/events/$eventId" params={{ eventId: event.id }} className="business-card-body">
    <h2>{event.title}</h2><p>{formatTimestamp(event.starts_at)} · {event.location}</p>
    </Link>
    <ImageGroup images={attachmentImages(event.attachments)} className="post-image-grid" />
    <Link to="/events/$eventId" params={{ eventId: event.id }} className="business-card-body">
    <footer className="content-card-actions task-card-actions"><span className={`task-status status-${event.status}`}>{eventDisplayStatus(event, now)}</span><strong className="rice-amount" aria-label={event.fee_amount ? `${event.fee_amount} 稻米每人` : '无需稻米'}>{event.fee_amount ? <><Sprout size={21} />{event.fee_amount}<small>/ 人</small></> : '无需稻米'}</strong></footer>
    </Link></article>
}

type EventsPageProps = { nodeId?: string; mine?: boolean; initialPage?: EventPage; refreshError?: string }
export function EventsPage(props: EventsPageProps) {
  const { session } = useStoredSession()
  return <EventList key={session?.token ?? 'guest'} {...props} />
}

function EventList({ nodeId, mine = false, initialPage, refreshError = '' }: EventsPageProps) {
  const { session, isReady } = useStoredSession()
  const [tab, setTab] = useState<'applied' | 'managed'>('applied')
  const usesRoutePage = Boolean(initialPage && !nodeId && !mine)
  const loadPage = useCallback((before?: string) => getEvents({ data: {
    token: session?.token, nodeId, mine: mine ? tab : undefined, before,
  } }), [session?.token, nodeId, mine, tab])
  const { rows, cursor, loading, error, visibleError, more } = usePagedBusinessList<RiceEvent>({
    initialPage, useRoutePage: usesRoutePage, isReady,
    disabled: mine && !session,
    refreshError, loadPage,
  })
  return <div className={`page events-page${nodeId ? ' business-panel list-panel' : ''}`}><div className="business-heading"><h1>{mine ? '我的活动' : nodeId ? '节点活动' : '活动'}</h1>{session && !mine && !nodeId && <Link to="/me/events">我的活动</Link>}</div>
    {mine && <div className="filter-buttons">{(['applied', 'managed'] as const).map((value) => <Button key={value} label={value === 'applied' ? '我申请的' : '我管理的'} variant="ghost" className={tab === value ? 'active' : undefined} aria-pressed={tab === value} onClick={() => setTab(value)} />)}</div>}
    {mine && !session && isReady && <LoginLink className="primary-link">登录后查看我的活动</LoginLink>}
    {visibleError && <p className="inline-error" role="alert">{visibleError}</p>}{loading && (rows.length ? <p className="refresh-status" role="status">正在加载活动…</p> : <LoadingState label="正在加载活动…" />)}
    <section className="task-list" aria-busy={loading}>{rows.map((event) => <EventCard event={event} key={event.id} />)}</section>
    {!loading && !visibleError && !rows.length && <EmptyState isCompact title="暂时没有活动。" />}{cursor && <AutoLoadMore key={`${nodeId}:${mine}:${tab}`} cursor={cursor} loading={loading || !isReady} failed={!!error} onLoadMore={more} />}
  </div>
}
