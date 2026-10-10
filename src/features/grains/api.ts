import { createServerFn } from '@tanstack/react-start'

import { backend, backendData, withQuery } from '~/lib/http'
import type { RicePublicUser } from '~/lib/models'
import { withProfileAvatars } from '../social/api'

export type WalletEntry = { id: string; kind: 'reserved' | 'refunded' | 'grant' | 'gift' | 'reward' | 'task_reward' | 'event_fee' | 'community_fund'; amount: number; memo?: string | null; subject_uri: string | null; inserted_at: string; from_user: Pick<RicePublicUser, 'id' | 'nickname' | 'handle'> | null; to_user: Pick<RicePublicUser, 'id' | 'nickname' | 'handle'> | null; from_node?: { id: string; name: string } | null; to_node?: { id: string; name: string } | null }
export type RiceWallet = { balance: number; frozen: number; earned: number; entries: WalletEntry[]; next_cursor?: string | null }
export const getWallet = createServerFn({ method: 'POST' })
  .validator((data: { token: string; before?: string; nodeId?: string }) => data)
  .handler(async ({ data }) => backendData<RiceWallet>(`/api/${data.nodeId ? `nodes/${encodeURIComponent(data.nodeId)}/wallet` : 'wallet'}${data.before ? `?before=${encodeURIComponent(data.before)}` : ''}`, { token: data.token }))
export function walletEntryIncoming(entry: WalletEntry, userId: string, nodeId?: string) { return entry.kind === 'refunded' || (entry.kind !== 'reserved' && (nodeId ? entry.to_node?.id === nodeId : entry.to_user?.id === userId)) }

type PersonalTransferInput = { token: string; to: string; amount: number; memo?: string; clientRequestId: string }
export type PersonalTransfer = { id: string; amount: number; to: Pick<RicePublicUser, 'id' | 'did' | 'handle' | 'nickname'> }
export async function requestPersonalTransfer(data: PersonalTransferInput) {
  if (!data.to.trim() || !Number.isSafeInteger(data.amount) || data.amount < 1) throw new Error('请选择送给谁，并输入正整数稻米数量。')
  const result = await backendData<PersonalTransfer>('/api/grain_transfers', {
    method: 'POST', token: data.token,
    json: { to: data.to.trim(), amount: data.amount, kind: 'gift', memo: data.memo?.trim(), client_request_id: data.clientRequestId },
  })
  if (!result?.id || result.amount !== data.amount || !result.to?.id || !result.to.handle) throw new Error('稻米送出结果不完整，请先查看稻米记录。')
  return result
}
export const sendPersonalGrains = createServerFn({ method: 'POST' })
  .validator((data: PersonalTransferInput) => data)
  .handler(({ data }) => requestPersonalTransfer(data))
type TransferRecipientInput = { token: string; identifier: string }
// 精确命中只有一个人(exact);否则是按昵称 / handle 找到的候选,可能为空
export type TransferRecipients = { exact: boolean; users: RicePublicUser[] }
export async function requestTransferRecipients(data: TransferRecipientInput): Promise<TransferRecipients> {
  const body = await backend<{ data: RicePublicUser[]; exact: boolean }>(withQuery('/api/grain_transfers/recipients', { q: data.identifier.trim().replace(/^@/, '') }), { token: data.token })
  return { exact: body.exact, users: await withProfileAvatars(body.data) }
}
export const findTransferRecipients = createServerFn({ method: 'POST' })
  .validator((data: TransferRecipientInput) => data)
  .handler(({ data }) => requestTransferRecipients(data))

export const fundCommunity = createServerFn({ method: 'POST' })
  .validator((data: { token: string; nodeId: string; amount: number; clientRequestId: string }) => data)
  .handler(async ({ data }) => backendData<RiceWallet>(`/api/nodes/${encodeURIComponent(data.nodeId)}/fund`, {
    method: 'POST', token: data.token, json: { amount: data.amount, client_request_id: data.clientRequestId },
  }))
