import { createServerFn } from '@tanstack/react-start'
import { BACKEND_BASE, readJson, requestJson } from '~/lib/http'
import type { RiceAttachment, RicePublicUser } from '~/lib/models'

export type Foundation = { fund_scale: number; proposal_approval_votes: number; documents: RiceAttachment[] }
export type Announcement = { id: string; title: string; position: number; attachment: RiceAttachment | null; inserted_at: string }
export type ProposalStatus = 'open' | 'passed' | 'rejected'
export type VoteChoice = 'agree' | 'oppose'
export type Proposal = {
  id: string; title: string; status: ProposalStatus; closes_at: string
  agree_count: number; oppose_count: number; total_votes: number; my_vote: VoteChoice | null
  attachment: RiceAttachment | null; author: RicePublicUser | null; inserted_at: string
}
export type GovernancePage<T> = { data: T[]; meta: { next_cursor: string | null } }
export type GrainGrantPage = { data: GrainGrant[]; meta: { next_cursor: string | null; total_granted: number } }
export type ProposalVote = { choice: VoteChoice; inserted_at: string }
export type ProposalComment = { id: string; body: string; author: RicePublicUser | null; inserted_at: string }
export type GrainGrant = { id: string; amount: number; memo: string; inserted_at: string; to: RicePublicUser | null; to_node: { id: string; name: string } | null }
type PageInput = { before?: string; limit?: number }

function pageQuery(data: PageInput & { status?: ProposalStatus }) {
  const query = new URLSearchParams()
  if (data.before) query.set('before', data.before)
  if (data.limit !== undefined) query.set('limit', String(data.limit))
  if (data.status) query.set('status', data.status)
  return query.size ? `?${query}` : ''
}

export async function loadFoundation() {
  return (await requestJson<{ data: Foundation }>(`${BACKEND_BASE}/api/settings/foundation`)).data
}

export function loadAnnouncements(data: PageInput) {
  return requestJson<GovernancePage<Announcement>>(`${BACKEND_BASE}/api/announcements${pageQuery(data)}`)
}

export function loadProposals(data: PageInput & { token?: string; status?: ProposalStatus }) {
  return requestJson<GovernancePage<Proposal>>(`${BACKEND_BASE}/api/proposals${pageQuery(data)}`, {
    headers: data.token ? { Authorization: `Bearer ${data.token}` } : undefined,
  })
}

export function loadGrainGrants(data: PageInput) {
  return requestJson<GrainGrantPage>(`${BACKEND_BASE}/api/grain_grants${pageQuery(data)}`)
}

export async function loadAnnouncement(data: { id: string }) {
  return (await requestJson<{ data: Announcement }>(`${BACKEND_BASE}/api/announcements/${encodeURIComponent(data.id)}`)).data
}

export async function loadProposal(data: { id: string; token?: string }) {
  return (await requestJson<{ data: Proposal }>(`${BACKEND_BASE}/api/proposals/${encodeURIComponent(data.id)}`, {
    headers: data.token ? { Authorization: `Bearer ${data.token}` } : undefined,
  })).data
}

export async function sendProposalVote(data: { id: string; token: string; choice: VoteChoice }) {
  return (await requestJson<{ data: ProposalVote }>(`${BACKEND_BASE}/api/proposals/${encodeURIComponent(data.id)}/vote`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice: data.choice }),
  })).data
}

export function loadProposalComments(data: { id: string } & PageInput) {
  return requestJson<GovernancePage<ProposalComment>>(`${BACKEND_BASE}/api/proposals/${encodeURIComponent(data.id)}/comments${pageQuery(data)}`)
}

export async function sendProposalComment(data: { id: string; token: string; body: string }) {
  return (await requestJson<{ data: ProposalComment }>(`${BACKEND_BASE}/api/proposals/${encodeURIComponent(data.id)}/comments`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: data.body }),
  })).data
}

export async function loadGovernanceBody(data: { id: string }) {
  if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.id)) throw new Error('正文附件无效。')
  let response: Response
  try { response = await fetch(`${BACKEND_BASE}/api/attachments/${encodeURIComponent(data.id)}`) }
  catch { throw new Error('网络连接失败，请检查网络后重试。') }
  if (!response.ok) await readJson(response)
  return (await response.text()).replace(/https?:\/\/[^/"'\s<>]+(?=\/api\/v1\/file\/download\?)/gi, '')
}

export const getFoundation = createServerFn({ method: 'GET' }).handler(() => loadFoundation())
export const getAnnouncements = createServerFn({ method: 'POST' })
  .validator((data: PageInput) => data).handler(({ data }) => loadAnnouncements(data))
export const getProposals = createServerFn({ method: 'POST' })
  .validator((data: PageInput & { token?: string; status?: ProposalStatus }) => data).handler(({ data }) => loadProposals(data))
export const getGrainGrants = createServerFn({ method: 'POST' })
  .validator((data: PageInput) => data).handler(({ data }) => loadGrainGrants(data))
export const getAnnouncement = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data).handler(({ data }) => loadAnnouncement(data))
export const getProposal = createServerFn({ method: 'POST' })
  .validator((data: { id: string; token?: string }) => data).handler(({ data }) => loadProposal(data))
export const voteOnProposal = createServerFn({ method: 'POST' })
  .validator((data: { id: string; token: string; choice: VoteChoice }) => data).handler(({ data }) => sendProposalVote(data))
export const getProposalComments = createServerFn({ method: 'POST' })
  .validator((data: { id: string } & PageInput) => data).handler(({ data }) => loadProposalComments(data))
export const postProposalComment = createServerFn({ method: 'POST' })
  .validator((data: { id: string; token: string; body: string }) => data).handler(({ data }) => sendProposalComment(data))
export const getGovernanceBody = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data).handler(({ data }) => loadGovernanceBody(data))
