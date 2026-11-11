import { createServerFn } from '@tanstack/react-start'
import { backend, backendData, withQuery } from '~/lib/http'
import { credential, id, object, optional, text } from '~/lib/validation'

export type PointWallet = { point_id: string; is_rice: boolean; name: string; status: string; wallet_status: string; available: string; held: string; earned: string }
export type PointEntry = { id: string; kind: string; available_delta: string; held_delta: string; public_note?: string; private_note?: string; inserted_at: string; recipients: { account_id: string; amount: string; note?: string }[] }
export const getPointWallets = createServerFn({ method: 'POST' })
  .validator(object({ token: credential }))
  .handler(({ data }) => backendData<PointWallet[]>('/api/point-wallets', { token: data.token }))
export const getPointHistory = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, pointId: id, before: optional(id) }))
  .handler(({ data }) => backend<{ data: PointEntry[]; meta: { next_cursor: string | null } }>(
    withQuery('/api/point-wallets/' + encodeURIComponent(data.pointId) + '/transactions', { before: data.before }), { token: data.token }))
export const sendPoints = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, pointId: id, to: text(320, 1), amount: text(19, 1), note: optional(text(512)), requestId: text(128, 1) }))
  .handler(({ data }) => backendData<{ id: string; amount: string; to: { nickname: string; handle: string } }>(
    '/api/point-wallets/' + encodeURIComponent(data.pointId) + '/transfers',
    { token: data.token, method: 'POST', json: { to: data.to, amount: data.amount, note: data.note, client_request_id: data.requestId } }))
