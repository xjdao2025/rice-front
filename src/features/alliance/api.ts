import { createServerFn } from '@tanstack/react-start'
import { BACKEND_BASE, backend, backendData, readJson, withQuery } from '~/lib/http'
import type { RiceAttachment, RicePublicUser } from '~/lib/models'
import { withAvatars } from '../social/api'

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

const pageQuery = (data: PageInput & { status?: ProposalStatus }) =>
  withQuery('', { before: data.before, limit: data.limit, status: data.status })
const proposalPath = (id: string) => `/api/proposals/${encodeURIComponent(id)}`

export function loadFoundation() {
  return backendData<Foundation>('/api/settings/foundation')
}

export function loadAnnouncements(data: PageInput) {
  return backend<GovernancePage<Announcement>>(`/api/announcements${pageQuery(data)}`)
}

export async function loadProposals(data: PageInput & { token?: string; status?: ProposalStatus }) {
  return withAvatars(await backend<GovernancePage<Proposal>>(`/api/proposals${pageQuery(data)}`, { token: data.token }))
}

export function loadGrainGrants(data: PageInput) {
  return backend<GrainGrantPage>(`/api/grain_grants${pageQuery(data)}`)
}

export async function loadAnnouncement(data: { id: string }) {
  return backendData<Announcement>(`/api/announcements/${encodeURIComponent(data.id)}`)
}

export async function loadProposal(data: { id: string; token?: string }) {
  return withAvatars(await backendData<Proposal>(proposalPath(data.id), { token: data.token }))
}

export async function sendProposalVote(data: { id: string; token: string; choice: VoteChoice }) {
  return backendData<ProposalVote>(`${proposalPath(data.id)}/vote`, { method: 'POST', token: data.token, json: { choice: data.choice } })
}

export async function loadProposalComments(data: { id: string } & PageInput) {
  return withAvatars(await backend<GovernancePage<ProposalComment>>(`${proposalPath(data.id)}/comments${pageQuery(data)}`))
}

export async function sendProposalComment(data: { id: string; token: string; body: string }) {
  return withAvatars(await backendData<ProposalComment>(`${proposalPath(data.id)}/comments`, { method: 'POST', token: data.token, json: { body: data.body } }))
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
