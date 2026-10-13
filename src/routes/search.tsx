import { UserIdentity } from '~/components/UserIdentity'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { createFileRoute, Link, useRouterState } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LoadingState } from '~/components/LoadingState'
import { PostCard } from '~/components/PostList'
import { getPosts } from '~/features/feed/api'
import { getEvents, type RiceEvent } from '~/features/events/api'
import { EventCard } from '~/features/events/EventsPage'
import { getNodes, type CommunityNode } from '~/features/nodes/api'
import { NodeListRow } from '~/features/nodes/NodesPanel'
import { useStoredSession } from '~/features/session/session'
import { searchUsers } from '~/features/social/api'
import { getTaskPage } from '~/features/tasks/api'
import { TaskCard } from '~/features/tasks/TaskCard'
import type { RiceTask } from '~/features/tasks/types'
import type { PostView, RicePublicUser, RiceSession } from '~/lib/models'
import { errorMessage } from '~/lib/util'

function searchQuery(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
export const Route = createFileRoute('/search')({ validateSearch: (search: Record<string, unknown>): { q?: string } => ({ q: searchQuery(search.q) }), component: SearchPage })
type SearchSnapshot = {
  q?: string
  query: string
  searched: string
  tasks: RiceTask[]
  posts: PostView[]
  events: RiceEvent[]
  nodes: CommunityNode[]
  users: RicePublicUser[]
  cursors: { tasks?: string; posts?: string; events?: string; users?: string }
  failedGroups: string[]
  error: string
  pendingQuery?: string
}
// One browser-history visit, kept only in memory while opening a result.
let savedSearch: { entryKey: string; accountId: string; state: SearchSnapshot } | undefined

export function SearchPage() {
  const { q } = Route.useSearch()
  const { session } = useStoredSession()
  const entryKey = useRouterState({ select: (state) => {
    const resolved = state.resolvedLocation
    // The pending destination can change before this visible search page unmounts.
    const location = resolved?.pathname === '/search' && searchQuery(resolved.search.q) === q ? resolved : state.location
    return location.state.__TSR_key ?? ''
  } })
  const accountId = session?.user.id ?? session?.pds.did ?? 'guest'
  return <SearchResults key={`${accountId}:${entryKey}`} q={q} session={session} entryKey={entryKey} accountId={accountId} />
}

function SearchResults({ q, session, entryKey, accountId }: { q?: string; session: RiceSession | null; entryKey: string; accountId: string }) {
  const navigate = Route.useNavigate()
  const initial = useRef(typeof window !== 'undefined' && savedSearch?.entryKey === entryKey && savedSearch.accountId === accountId && savedSearch.state.q === q ? savedSearch.state : undefined).current
  const [query, setQuery] = useState(initial?.query ?? q ?? '')
  const [searched, setSearched] = useState(initial?.searched ?? '')
  const [tasks, setTasks] = useState<RiceTask[]>(initial?.tasks ?? [])
  const [posts, setPosts] = useState<PostView[]>(initial?.posts ?? [])
  const [events, setEvents] = useState<RiceEvent[]>(initial?.events ?? [])
  const [nodes, setNodes] = useState<CommunityNode[]>(initial?.nodes ?? [])
  const [users, setUsers] = useState<RicePublicUser[]>(initial?.users ?? [])
  const [cursors, setCursors] = useState<{ tasks?: string; posts?: string; events?: string; users?: string }>(initial?.cursors ?? {})
  const [failedGroups, setFailedGroups] = useState<string[]>(initial?.failedGroups ?? [])
  const [error, setError] = useState(initial?.error ?? '')
  const [loading, setLoading] = useState(false)
  const version = useRef(0)
  const pendingQuery = useRef<string | undefined>(undefined)
  const snapshot = useRef<SearchSnapshot>({ q, query, searched, tasks, posts, events, nodes, users, cursors, failedGroups, error })
  snapshot.current = { q, query, searched, tasks, posts, events, nodes, users, cursors, failedGroups, error, pendingQuery: pendingQuery.current }
  useEffect(() => {
    if (savedSearch?.accountId !== accountId) savedSearch = undefined
    return () => {
      ++version.current
      if (typeof window !== 'undefined') savedSearch = { entryKey, accountId, state: snapshot.current }
    }
  }, [entryKey, accountId])
  const search = async (value = query) => {
    value = value.trim(); if (!value) return
    const current = ++version.current
    pendingQuery.current = value
    setLoading(true); setError(''); setSearched(value); setTasks([]); setPosts([]); setEvents([]); setNodes([]); setUsers([]); setCursors({}); setFailedGroups([])
    const result = await Promise.allSettled([
      getTaskPage({ data: { q: value, token: session?.token, limit: 10 } }),
      getPosts({ data: { query: value, accessJwt: session?.pds.access_jwt, did: session?.pds.did, limit: 10, category: 'post' } }),
      getEvents({ data: { q: value, token: session?.token } }),
      getNodes({ data: { q: value, token: session?.token } }),
      searchUsers({ data: { q: value } }),
    ])
    if (current !== version.current) return
    const [t, p, e, n, u] = result
    if (t.status === 'fulfilled') setTasks(t.value.data)
    if (p.status === 'fulfilled') setPosts(p.value.posts)
    if (e.status === 'fulfilled') setEvents(e.value.data)
    if (n.status === 'fulfilled') setNodes(n.value)
    if (u.status === 'fulfilled') setUsers(u.value.data)
    setCursors({ tasks: t.status === 'fulfilled' ? t.value.meta.next_cursor ?? undefined : undefined, posts: p.status === 'fulfilled' ? p.value.cursor ?? undefined : undefined, events: e.status === 'fulfilled' ? e.value.meta?.next_cursor ?? undefined : undefined, users: u.status === 'fulfilled' ? u.value.meta.next_cursor ?? undefined : undefined })
    setFailedGroups(['任务', '帖子', '活动', '节点', '用户'].filter((_, index) => result[index].status === 'rejected'))
    if (result.some((r) => r.status === 'rejected')) setError('部分搜索结果暂时无法加载，请重试。')
    pendingQuery.current = undefined
    setLoading(false)
  }
  useEffect(() => {
    if (initial && !initial.pendingQuery) return
    const value = initial?.pendingQuery || q
    if (value) void search(value)
  }, [q])
  const submit = () => {
    const value = query.trim()
    if (!value) return
    if (value !== q) void navigate({ search: { q: value }, replace: true })
    else void search(value)
  }
  const more = async (kind: 'tasks' | 'posts' | 'events' | 'users') => {
    if (!cursors[kind] || loading) return
    const current = version.current; setLoading(true); setError('')
    try {
      if (kind === 'tasks') { const page = await getTaskPage({ data: { q: searched, token: session?.token, before: cursors.tasks, limit: 10 } }); if (current === version.current) { setTasks((r) => [...r, ...page.data]); setCursors((c) => ({ ...c, tasks: page.meta.next_cursor ?? undefined })) } }
      else if (kind === 'events') { const page = await getEvents({ data: { q: searched, token: session?.token, before: cursors.events } }); if (current === version.current) { setEvents((r) => [...r, ...page.data]); setCursors((c) => ({ ...c, events: page.meta?.next_cursor ?? undefined })) } }
      else if (kind === 'users') { const page = await searchUsers({ data: { q: searched, before: cursors.users } }); if (current === version.current) { setUsers((r) => [...r, ...page.data]); setCursors((c) => ({ ...c, users: page.meta.next_cursor ?? undefined })) } }
      else { const page = await getPosts({ data: { query: searched, accessJwt: session?.pds.access_jwt, did: session?.pds.did, cursor: cursors.posts, limit: 10, category: 'post' } }); if (current === version.current) { setPosts((r) => [...r, ...page.posts]); setCursors((c) => ({ ...c, posts: page.cursor ?? undefined })) } }
    } catch (e) { if (current === version.current) setError(errorMessage(e, '加载失败')) } finally { if (current === version.current) setLoading(false) }
  }
  const emptyMessage = (title: string) => failedGroups.includes(title) ? '暂时无法加载，请重试。' : loading ? '' : `没有相关${title}`
  const hasResults = posts.length + tasks.length + events.length + nodes.length + users.length > 0
  return <div className="page search-page"><header className="search-header"><div className="global-search-field"><TextInput label="搜索帖子、任务、活动、节点、用户" isLabelHidden placeholder="搜索帖子、任务、活动、节点、用户" value={query} onChange={setQuery} onEnter={submit} width="100%" hasClear /><Button label="搜索" variant="primary" isDisabled={!query.trim() || loading} clickAction={submit} /></div></header>
    {error && <p className="inline-error" role="alert">{error}</p>}{loading && <LoadingState label={hasResults ? '正在加载更多结果…' : '正在搜索…'} />}
    {!searched ? <p className="search-hint">输入关键词，搜索帖子、任务、活动、节点、用户。</p> : loading && !hasResults ? null : <div key={searched}>
      <SearchGroup title="帖子" count={posts.length} hasMore={!!cursors.posts} emptyMessage={emptyMessage('帖子')}>
        <div className="post-list">{posts.map((post) => <PostCard post={post} key={post.uri} />)}</div>
        {cursors.posts && <Button label="更多帖子" variant="ghost" isDisabled={loading} clickAction={() => more('posts')} />}
      </SearchGroup>
      <SearchGroup title="任务" count={tasks.length} hasMore={!!cursors.tasks} emptyMessage={emptyMessage('任务')}>
        <div className="task-list">{tasks.map((task) => <TaskCard task={task} key={task.id} />)}</div>
        {cursors.tasks && <Button label="更多任务" variant="ghost" isDisabled={loading} clickAction={() => more('tasks')} />}
      </SearchGroup>
      <SearchGroup title="活动" count={events.length} hasMore={!!cursors.events} emptyMessage={emptyMessage('活动')}>
        <div className="task-list">{events.map((event) => <EventCard event={event} key={event.id} />)}</div>
        {cursors.events && <Button label="更多活动" variant="ghost" isDisabled={loading} clickAction={() => more('events')} />}
      </SearchGroup>
      <SearchGroup title="节点" count={nodes.length} emptyMessage={emptyMessage('节点')}>
        <ul className="node-list node-directory">{nodes.map((node) => <NodeListRow node={node} key={node.id} />)}</ul>
      </SearchGroup>
      <SearchGroup title="用户" count={users.length} hasMore={!!cursors.users} emptyMessage={emptyMessage('用户')}>
        <div className="people-list">{users.map((user) => <Link to="/profile/$actor" params={{ actor: user.did }} className="person-row search-person-row" key={user.id}>
          <UserIdentity user={user} detail={user.bio && <p>{user.bio}</p>} />
        </Link>)}</div>
        {cursors.users && <Button label="更多用户" variant="ghost" isDisabled={loading} clickAction={() => more('users')} />}
      </SearchGroup>
    </div>}
  </div>
}

function SearchGroup({ title, count, hasMore, emptyMessage, children }: { title: string; count: number; hasMore?: boolean; emptyMessage: string; children: ReactNode }) {
  return <details className="business-section search-result-group" open>
    <summary><h2>{title} · {count}{hasMore ? '+' : ''}</h2><span className="search-group-toggle"><span className="search-group-collapse">收起</span><span className="search-group-expand">展开</span><ChevronDown size={18} aria-hidden="true" /></span></summary>
    {count ? children : emptyMessage ? <p className="search-group-empty">{emptyMessage}</p> : null}
  </details>
}
