import { Button } from '@astryxdesign/core/Button'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Avatar } from '~/components/Avatar'
import { LoadingState } from '~/components/LoadingState'
import { DetailDialog } from '~/components/DetailDialog'
import { formatTimestamp } from '~/lib/format'
import { LoginLink } from '../session/LoginLink'
import { useStoredSession } from '../session/session'
import { applyToNode, getNode, getNodes, reviewNodeApplication, updateNodeMemberRole, type CommunityNode, type NodeMine } from './api'

export function NodeListRow({ node }: { node: CommunityNode }) {
  const { session } = useStoredSession()
  const navigate = useNavigate()
  const [submitted, setSubmitted] = useState<{ token: string; applicationId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = node.my_application?.status === 'pending' || (submitted !== null && submitted.token === session?.token && submitted.applicationId !== node.my_application?.id)
  const unavailable = !!node.role || pending || !node.owner
  const apply = async () => {
    if (!session || busy || unavailable) return
    setBusy(true); setError('')
    try {
      const updated = await applyToNode({ data: { token: session.token, nodeId: node.id, reason: '' } })
      if (updated.my_application) setSubmitted({ token: session.token, applicationId: updated.my_application.id })
      window.dispatchEvent(new Event('rice-changed'))
    } catch (e) { setError(e instanceof Error ? e.message : '申请提交失败') } finally { setBusy(false) }
  }
  return <li className="profile-menu-row node-directory-row">
    <Link to="/nodes/$nodeId" params={{ nodeId: node.id }} className="node-directory-identity"><Avatar name={node.name} src={node.logo?.url} /><strong>{node.name}</strong></Link>
    <div className="node-directory-actions">
      {!session && !unavailable ? <LoginLink className="primary-link">申请加入</LoginLink> : <Button label={node.role ? '已加入' : pending ? '申请中' : !node.owner ? '暂未开放' : '申请加入'} variant="primary" size="sm" isDisabled={unavailable || busy} isLoading={busy} clickAction={apply} />}
      <Button label="查看介绍" variant="secondary" size="sm" onClick={() => void navigate({ to: '/nodes/$nodeId', params: { nodeId: node.id } })} />
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </li>
}

export function NodesPanel({ identity = false }: { identity?: boolean }) {
  const { session, isReady } = useStoredSession()
  const owner = session?.user.id ?? 'guest'
  const [data, setData] = useState<{ owner: string; nodes: CommunityNode[] } | null>(null)
  const [filter, setFilter] = useState<NodeMine | undefined>(identity ? 'identity' : undefined)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  useEffect(() => { const refresh = () => setVersion((v) => v + 1); window.addEventListener('rice-changed', refresh); return () => window.removeEventListener('rice-changed', refresh) }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (!isReady) return
    let active = true
    setLoading(true); setError('')
    void getNodes({ data: { token: session?.token, mine: filter, q: search } }).then((nodes) => { if (active) setData({ owner, nodes }) })
      .catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isReady, owner, session?.token, filter, search, version])
  const nodes = data?.owner === owner ? data.nodes : null
  return <div className="page business-panel list-panel" aria-busy={loading || query !== search}>
    {!identity && <><input className="business-search" aria-label="搜索节点" placeholder="搜索节点" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="filter-buttons">{([[undefined, '全部节点'], ['joined', '已加入'], ['pending', '申请中']] as const).map(([value, label]) => <Button key={label} label={label} variant="ghost" className={filter === value ? 'active' : undefined} aria-pressed={filter === value} onClick={() => setFilter(value)} />)}</div></>}
    {error && <p className="inline-error" role="alert">{error}</p>}{!nodes && !error && <LoadingState label="正在加载节点…" />}
    <ul className="node-list node-directory">{nodes?.map((node) => <NodeListRow node={node} key={node.id} />)}</ul>
    {nodes && !error && !nodes.length && <p className="search-hint">{identity ? '还没有节点身份或待处理的申请。' : '没有找到节点。'}</p>}
  </div>
}

export function NodeDetail({ nodeId }: { nodeId: string }) {
  const { session } = useStoredSession()
  const navigate = useNavigate()
  const [node, setNode] = useState<CommunityNode | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [roleChange, setRoleChange] = useState<{ userId: string; name: string; role: 'admin' | 'member' } | null>(null)
  useEffect(() => {
    let active = true
    setNode(null); setError('')
    void getNode({ data: { id: nodeId, token: session?.token } }).then((value) => { if (active) setNode(value) }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [nodeId, session?.token])
  const run = async (action: () => Promise<CommunityNode>) => { setBusy(true); setError(''); try { setNode(await action()); setRoleChange(null); window.dispatchEvent(new Event('rice-changed')) } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) } }
  return <div className="page business-panel">{error && <p className="inline-error" role="alert">{error}</p>}{!node && !error && <LoadingState label="正在加载节点…" />}{node && <>
    <div className="node-detail-heading"><Avatar name={node.name} src={node.logo?.url} size="large" /><h1>{node.name}</h1></div>
    {node.description && <p className="business-description">{node.description}</p>}
    <section className="business-section"><h2>节点稻米</h2><div className="grain-metrics"><div><b>{(node.grain_balance + node.grain_frozen_balance).toLocaleString('zh-CN')}</b><span>稻米余额</span></div><div><b>{node.grain_balance.toLocaleString('zh-CN')}</b><span>可用稻米</span></div><div><b>{node.grain_frozen_balance.toLocaleString('zh-CN')}</b><span>冻结稻米</span></div></div>
      {node.role === 'admin' && <Button label="查看节点稻米明细" variant="secondary" onClick={() => void navigate({ to: '/nodes/$nodeId/grains', params: { nodeId } })} />}
    </section>
    {node.role ? <p className="task-neutral-note">我的身份：{node.role === 'admin' ? '管理员' : '正式成员'}</p> : node.my_application?.status === 'pending' ? <p className="task-neutral-note">加入申请已提交，等待管理员审批。</p> : node.my_application?.status === 'rejected' ? <p className="task-neutral-note">加入申请未通过。{node.my_application.review_reason}</p> : null}
    <section className="business-section"><h2>节点成员</h2>{node.members?.map(({ user, role }) => <div className="candidate" key={user.id}>
      <div className="business-heading"><p><Link to="/profile/$actor" params={{ actor: user.did }}>{user.nickname || user.handle}</Link> · {role === 'admin' ? '管理员' : '成员'}</p>
        {node.can_manage_members && user.id !== node.owner?.id && <Button label={role === 'admin' ? '撤销管理员' : '设为管理员'} variant="ghost" isDisabled={busy} onClick={() => { setError(''); setRoleChange({ userId: user.id, name: user.nickname || user.handle, role: role === 'admin' ? 'member' : 'admin' }) }} />}
      </div>
    </div>)}</section>
    {roleChange && session && <DetailDialog title="确认修改管理员身份" className="post-dialog business-dialog compose-close-dialog" onClose={() => { if (!busy) setRoleChange(null) }}><div className="business-panel form-stack">
      <p>{roleChange.role === 'admin' ? `确认将 ${roleChange.name} 设为管理员？管理员可管理此节点的任务、活动、申请和节点稻米。` : `确认撤销 ${roleChange.name} 的管理员身份？个人账户和已有业务记录将保留。`}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="form-actions"><Button label="返回" variant="secondary" isDisabled={busy} onClick={() => setRoleChange(null)} /><Button label="确认修改" variant="primary" isDisabled={busy} clickAction={() => run(() => updateNodeMemberRole({ data: { token: session.token, nodeId, userId: roleChange.userId, role: roleChange.role } }))} /></div>
    </div></DetailDialog>}
    {node.role === 'admin' && session && <section className="business-section"><h2>待审批申请</h2>{node.applications?.filter((a) => a.status === 'pending').map((a) => <article className="candidate" key={a.id}><strong>{a.user?.nickname || a.user?.handle}</strong><p>{a.reason}</p><div className="form-actions"><Button label="拒绝" variant="secondary" isDisabled={busy} clickAction={() => run(() => reviewNodeApplication({ data: { token: session.token, nodeId, applicationId: a.id, action: 'reject' } }))} /><Button label="通过" variant="primary" isDisabled={busy} clickAction={() => run(() => reviewNodeApplication({ data: { token: session.token, nodeId, applicationId: a.id, action: 'approve' } }))} /></div></article>)}{!node.applications?.some((a) => a.status === 'pending') && <p>暂无待审批申请。</p>}</section>}
    {node.role === 'admin' && node.applications?.some((a) => a.status !== 'pending') && <details className="business-section"><summary>已处理申请</summary><ul className="business-history">{node.applications.filter((a) => a.status !== 'pending').map((a) => <li key={a.id}><strong>{a.user?.nickname || a.user?.handle} · {a.status === 'approved' ? '已通过' : '未通过'}</strong><p>{a.reason}</p>{a.review_reason && <p>{a.review_reason}</p>}<time>{formatTimestamp(a.reviewed_at || a.inserted_at)}</time></li>)}</ul></details>}
    <section className="business-section"><h2>节点动态</h2><div className="button-row"><Button label="节点任务" variant="secondary" onClick={() => void navigate({ to: '/nodes/$nodeId/tasks', params: { nodeId } })} /><Button label="节点活动" variant="secondary" onClick={() => void navigate({ to: '/nodes/$nodeId/events', params: { nodeId } })} /></div></section>
  </>}</div>
}
