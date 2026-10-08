import { Button } from '@astryxdesign/core/Button'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '~/components/Avatar'
import { AutoLoadMore } from '~/components/AutoLoadMore'
import { ContentCardHeader } from '~/components/ContentCardHeader'
import { DetailDialog } from '~/components/DetailDialog'
import { LoadingState } from '~/components/LoadingState'
import { useTimeBoundary } from '~/components/useTimeBoundary'
import { publicAttachmentUrl } from '~/lib/attachments'
import { formatTimestamp } from '~/lib/format'
import type { RiceAttachment } from '~/lib/models'
import { getNodes, type CommunityNode } from '../nodes/api'
import { LoginLink } from '../session/LoginLink'
import { readStoredSession, useStoredSession } from '../session/session'
import { getAnnouncement, getAnnouncements, getFoundation, getGovernanceBody, getGrainGrants, getProposal, getProposals, voteOnProposal, type Announcement, type Foundation, type GovernancePage, type Proposal, type ProposalStatus, type VoteChoice } from './api'
import { ProposalComments } from './ProposalComments'

const statusLabels = { open: '进行中', passed: '已通过', rejected: '未通过' }

// Both governance lists share cursor loading and reject replies from a previous filter/session.
function useGovernanceList<T extends { id: string }>(key: string, load: (before?: string) => Promise<GovernancePage<T>>) {
  const [state, setState] = useState<{ key: string; page: GovernancePage<T> | null; loading: boolean; error: string }>({ key, page: null, loading: true, error: '' })
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  const pending = useRef(false)
  useEffect(() => {
    const version = ++request.current
    pending.current = true
    setState({ key, page: null, loading: true, error: '' })
    void load().then((page) => { if (version === request.current) setState({ key, page, loading: false, error: '' }) })
      .catch((e: Error) => { if (version === request.current) setState({ key, page: null, loading: false, error: e.message }) })
      .finally(() => { if (version === request.current) pending.current = false })
    return () => { ++request.current; pending.current = false }
  }, [key, revision])
  const current = state.key === key ? state : null
  const more = async () => {
    const before = current?.page?.meta.next_cursor
    if (!before || pending.current) return
    const version = request.current
    pending.current = true; setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const page = await load(before)
      if (version === request.current) setState((s) => ({ ...s, loading: false, page: { ...page, data: [...new Map([...(s.page?.data ?? []), ...page.data].map((item) => [item.id, item])).values()] } }))
    } catch (e) { if (version === request.current) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : '加载失败。' })) }
    finally { if (version === request.current) pending.current = false }
  }
  return { page: current?.page, loading: current?.loading ?? true, error: current?.error ?? '', more, retry: () => setRevision((v) => v + 1) }
}

export function AlliancePanel() {
  const [foundation, setFoundation] = useState<Foundation | null>(null)
  const [totalGranted, setTotalGranted] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void Promise.all([getFoundation(), getGrainGrants({ data: { limit: 1 } })])
      .then(([value, grants]) => { if (active) { setFoundation(value); setTotalGranted(grants.meta.total_granted) } })
      .catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [revision])
  return <div className="page business-panel list-panel alliance-panel">
    <section aria-label="乡建DAO金库">
      <div className="business-heading"><h2>乡建DAO金库</h2>{!!foundation?.documents.length && <Link to="/alliance/documents" aria-label="查看金库公示文件">更多</Link>}</div>
      {error && <p className="inline-error" role="alert">{error} <Button label="重试" variant="ghost" onClick={() => setRevision((v) => v + 1)} /></p>}
      {!foundation && !error && <LoadingState label="正在加载金库信息…" />}
      {foundation && <div className="alliance-stats grain-metrics">
        <div><span>金库规模</span><b>¥ {foundation.fund_scale.toLocaleString('zh-CN')}</b></div>
        <Link to="/alliance/grain-grants" aria-label="查看已发行稻米明细"><span>已发行稻米数</span><b>{totalGranted?.toLocaleString('zh-CN')}</b><small>查看发放记录 →</small></Link>
      </div>}
    </section>
    <Announcements />
    <NodePreview />
    <Proposals />
  </div>
}

function NodePreview() {
  const [nodes, setNodes] = useState<CommunityNode[] | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void getNodes({ data: {} }).then((value) => { if (active) setNodes(value) }).catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [revision])
  return <section aria-label="节点"><div className="business-heading"><h2>节点</h2><Link to="/alliance/nodes" aria-label="查看全部节点">更多</Link></div>
    {error && <p className="inline-error" role="alert">{error} <Button label="重试" variant="ghost" onClick={() => setRevision((v) => v + 1)} /></p>}
    {!nodes && !error && <LoadingState label="正在加载节点…" />}
    <div className="alliance-node-preview">{nodes?.slice(0, 4).map((node) => <Link to="/nodes/$nodeId" params={{ nodeId: node.id }} key={node.id} aria-label={`查看${node.name}`}><Avatar name={node.name} src={node.logo?.url} /></Link>)}</div>
    {nodes && !nodes.length && <p className="muted">暂无节点。</p>}
  </section>
}

function Announcements() {
  const list = useGovernanceList('announcements', (before) => getAnnouncements({ data: { before } }))
  return <section aria-label="公告栏"><h2>公告栏</h2>
    {list.error && <p className="inline-error" role="alert">{list.error}</p>}
    {!list.page && (list.error ? <Button label="重试" variant="secondary" onClick={list.retry} /> : <LoadingState label="正在加载公告…" />)}
    <div className="node-list">{list.page?.data.map((announcement) => <Link key={announcement.id} to="/alliance/announcements/$id" params={{ id: announcement.id }} className="profile-menu-row node-card"><span className="profile-menu-copy"><strong>{announcement.title}</strong><small>{formatTimestamp(announcement.inserted_at)}</small></span><ChevronRight className="row-chevron" aria-hidden="true" /></Link>)}</div>
    {list.page && !list.page.data.length && <p className="muted">暂无公告。</p>}
    {list.page?.meta.next_cursor && <AutoLoadMore cursor={list.page.meta.next_cursor} loading={list.loading} failed={!!list.error} onLoadMore={list.more} />}
  </section>
}

function Proposals() {
  const { session } = useStoredSession()
  const token = session?.token
  const [status, setStatus] = useState<ProposalStatus | undefined>()
  const list = useGovernanceList(`${token}:${status}`, (before) => getProposals({ data: { token, status, before } }))
  return <section aria-label="提案"><h2>提案</h2>
    <div className="filter-buttons" role="group" aria-label="提案状态">{([[undefined, '全部'], ['open', '进行中'], ['passed', '通过'], ['rejected', '未通过']] as const).map(([value, label]) => <Button key={label} label={label} variant="ghost" className={status === value ? 'active' : undefined} aria-pressed={status === value} onClick={() => setStatus(value)} />)}</div>
    {list.error && <p className="inline-error" role="alert">{list.error}</p>}
    {!list.page && (list.error ? <Button label="重试" variant="secondary" onClick={list.retry} /> : <LoadingState label="正在加载提案…" />)}
    <div className="post-list">{list.page?.data.map((proposal) => <article key={proposal.id} className="content-card business-card task-card">
      <ProposalHeader proposal={proposal} />
      <Link to="/alliance/proposals/$id" params={{ id: proposal.id }} className="business-card-body"><h2>{proposal.title}</h2><VoteResults proposal={proposal} /></Link>
    </article>)}</div>
    {list.page && !list.page.data.length && <p className="muted">暂无{status ? statusLabels[status] : ''}提案。</p>}
    {list.page?.meta.next_cursor && <AutoLoadMore key={`${token}:${status}`} cursor={list.page.meta.next_cursor} loading={list.loading} failed={!!list.error} onLoadMore={list.more} />}
  </section>
}

function ProposalHeader({ proposal }: { proposal: Proposal }) {
  return <ContentCardHeader name={proposal.author?.nickname || proposal.author?.handle || '乡建DAO'} profileActor={proposal.author?.did} avatarUrl={proposal.author?.avatar ? publicAttachmentUrl(proposal.author.avatar.url) : undefined} timestamp={formatTimestamp(proposal.inserted_at)} aside={<span className="task-status">{statusLabels[proposal.status]}</span>} />
}

function VoteResults({ proposal }: { proposal: Proposal }) {
  return <div className="proposal-results">{([['同意', proposal.agree_count], ['反对', proposal.oppose_count]] as const).map(([label, count]) => {
    const percentage = proposal.total_votes ? Math.round(count / proposal.total_votes * 100) : 0
    return <div key={label}><span>{label}</span><div className="proposal-vote-track" role="meter" aria-label={`${label} ${count} 票`} aria-valuemin={0} aria-valuemax={proposal.total_votes || 1} aria-valuenow={count}><span style={{ width: `${percentage}%` }} /></div><span>{count}（{percentage}%）</span></div>
  })}</div>
}

export function GovernanceDetail({ kind, id }: { kind: 'announcement' | 'proposal'; id: string }) {
  const { session } = useStoredSession()
  const token = session?.token
  const [document, setDocument] = useState<Announcement | Proposal | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [voteChoice, setVoteChoice] = useState<VoteChoice | null>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    setError('')
    void (kind === 'proposal' ? getProposal({ data: { id, token } }) : getAnnouncement({ data: { id } })).then((value) => { if (active) setDocument(value) }).catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [kind, id, token, revision])
  const proposal = document && 'status' in document ? document : null
  const now = useTimeBoundary([proposal?.closes_at])
  const open = proposal?.status === 'open' && Date.parse(proposal.closes_at) > now
  const current = () => mounted.current && readStoredSession()?.token === token
  const vote = async (choice: VoteChoice) => {
    if (!token || !current() || pending.current || !open || proposal?.my_vote) return
    pending.current = true; setBusy(true); setError('')
    try {
      const receipt = await voteOnProposal({ data: { id, token, choice } })
      if (!current()) return
      setDocument((value) => value && 'status' in value ? { ...value, my_vote: receipt.choice } : value)
      setVoteChoice(null)
      const value = await getProposal({ data: { id, token } })
      if (current()) setDocument(value)
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : '投票失败。') }
    finally { pending.current = false; if (current()) setBusy(false) }
  }
  const closeConfirmation = () => { if (!pending.current) setVoteChoice(null) }
  const feedback = error && <p className="inline-error" role="alert">{error} <Button label="刷新" variant="ghost" isDisabled={busy} onClick={() => { if (!pending.current) { setVoteChoice(null); setRevision((v) => v + 1) } }} /></p>
  return <div className="page content-card business-panel governance-detail">
    {!voteChoice && feedback}
    {!document && !error && <LoadingState label="正在加载详情…" />}
    {document && <>{proposal && <ProposalHeader proposal={proposal} />}<h1>{document.title}</h1>{!proposal && <time className="muted">{formatTimestamp(document.inserted_at)}</time>}
      {document.attachment ? <GovernanceBody key={document.attachment.id} attachment={document.attachment} /> : <p className="muted">暂无正文。</p>}
      {proposal && <section className="business-section"><p>总投票数：{proposal.total_votes} · {open ? `截止时间：${formatTimestamp(proposal.closes_at)}` : '已结束'}</p><VoteResults proposal={proposal} />
        {proposal.my_vote ? <p role="status">已投票：{proposal.my_vote === 'agree' ? '同意' : '反对'}</p> : open && (session ? <div className="form-actions"><Button label="同意" variant="primary" isDisabled={busy} onClick={() => { setError(''); setVoteChoice('agree') }} /><Button label="反对" variant="secondary" isDisabled={busy} onClick={() => { setError(''); setVoteChoice('oppose') }} /></div> : <LoginLink>登录后投票</LoginLink>)}
      </section>}
      {proposal && <ProposalComments key={proposal.id} proposalId={proposal.id} />}
    </>}
    {proposal && voteChoice && <DetailDialog title="确认投票" className="post-dialog business-dialog compose-close-dialog" onClose={closeConfirmation}><div className="business-panel form-stack">
      <strong>{proposal.title}</strong><p>确认投票：{voteChoice === 'agree' ? '同意' : '反对'}？</p><p className="muted">投票后无法修改。</p>
      {feedback}
      {!open && <p role="alert">投票已结束。</p>}
      <div className="form-actions"><Button label="取消" variant="secondary" isDisabled={busy} onClick={closeConfirmation} /><Button label="确认投票" variant="primary" isLoading={busy} isDisabled={busy || !open || !!proposal.my_vote} clickAction={() => vote(voteChoice)} /></div>
    </div></DetailDialog>}
  </div>
}

export function observeGovernanceBody(frame: HTMLIFrameElement) {
  const body = frame.contentDocument?.body
  if (!body) return
  const resize = () => { frame.style.height = `${body.scrollHeight}px` }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(body)
  return () => observer.disconnect()
}

function GovernanceBody({ attachment }: { attachment: RiceAttachment }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  const stopObserving = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => stopObserving.current?.(), [])
  const readable = attachment.content_type.startsWith('text/')
  const image = attachment.content_type.startsWith('image/')
  useEffect(() => {
    if (!readable) return
    let active = true
    void getGovernanceBody({ data: { id: attachment.id } }).then((value) => { if (active) setHtml(value) }).catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [attachment.id, readable])
  const url = publicAttachmentUrl(attachment.url)
  // Legacy proposals stored HTML in text/plain .txt attachments.
  const htmlPreview = attachment.content_type === 'text/html' || /<(?:!doctype|html|body|p|div|h[1-6]|img|ul|ol|li|br|table|blockquote|a|span|strong)(?:\s|>)/i.test(html ?? '')
  const theme = html === null ? null : window.getComputedStyle(window.document.documentElement)
  const bodyStyle = theme ? `html,body{height:auto!important;min-height:0!important;max-height:none!important;overflow:hidden!important;background:transparent!important}body{display:flow-root!important;margin:0;color:${theme.getPropertyValue('--xj-text-soft')};font-size:${theme.getPropertyValue('--xj-font-body')};line-height:${theme.getPropertyValue('--xj-detail-body-line-height')};overflow-wrap:anywhere}.proposal-content{padding-top:0!important;font-size:inherit!important;line-height:inherit!important;word-break:normal!important}img{position:static!important;max-width:100%!important;width:auto!important;height:auto!important;object-fit:contain!important}*:has(>img){max-width:100%!important;max-height:none!important;aspect-ratio:auto!important;overflow:visible!important}a{color:${theme.getPropertyValue('--xj-accent')}}` : ''
  return <div className="governance-body">
    {error && <p className="inline-error" role="alert">正文暂时无法加载：{error}</p>}
    {readable && html === null && !error && <LoadingState label="正在加载正文…" />}
    {html !== null && (htmlPreview ? <iframe title={attachment.filename || '正文'} sandbox="allow-same-origin" referrerPolicy="no-referrer" onLoad={(event) => { stopObserving.current?.(); stopObserving.current = observeGovernanceBody(event.currentTarget) }} srcDoc={`<base href="${new URL(url, window.location.origin).href.replaceAll('"', '&quot;')}"><style>${bodyStyle}</style>${html}`} /> : <p className="business-description">{html}</p>)}
    {image && <img className="governance-attachment-image" src={url} alt={attachment.filename || '附件图片'} />}
    <a href={readable ? `${url}?download=1` : url} target="_blank" rel="noopener noreferrer">{readable ? '下载原文附件' : '打开附件'}</a>
  </div>
}
