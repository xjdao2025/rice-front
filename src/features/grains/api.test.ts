import { afterEach, expect, it, vi } from 'vitest'
import { requestPersonalTransfer, requestTransferRecipients, walletEntryIncoming, type WalletEntry } from './api'

afterEach(() => vi.unstubAllGlobals())
it('looks up recipients through the authenticated Rice search endpoint', async () => {
  // 带了 rice 头像就不会再去 AppView 补（补头像见 social/api.test.ts）
  const recipient = { id: 'receiver', did: 'did:plc:receiver', handle: 'receiver.example', nickname: '禾', avatar: { url: '/a.png' } }
  const fetch = vi.fn().mockImplementation(() => Response.json({ data: [recipient], exact: true }))
  vi.stubGlobal('fetch', fetch)
  for (const [identifier, q] of [[' 13800138000 ', '13800138000'], [' @receiver.example ', 'receiver.example'], ['禾', '禾']]) {
    expect(await requestTransferRecipients({ token: 'rice-token', identifier })).toEqual({ exact: true, users: [recipient] })
    const [url, init] = fetch.mock.calls.at(-1)!
    expect(new URL(url, 'https://x.test').pathname).toBe('/api/grain_transfers/recipients')
    expect(new URL(url, 'https://x.test').searchParams.get('q')).toBe(q)
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer rice-token' } })
  }
})
it('sends personal gifts with Rice auth, rejects invalid amounts before transport and refuses incomplete receipts', async () => {
  const receipt = { id: 'gift-1', amount: 12, to: { id: 'receiver', did: 'did:plc:receiver', handle: 'receiver.example', nickname: '禾' } }
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: receipt }))
  vi.stubGlobal('fetch', fetch)
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(requestPersonalTransfer({ token: 'rice-token', to: 'receiver', amount, clientRequestId: 'gift-key' })).rejects.toThrow('正整数')
  }
  await expect(requestPersonalTransfer({ token: 'rice-token', to: ' ', amount: 1, clientRequestId: 'gift-key' })).rejects.toThrow('送给谁')
  expect(fetch).not.toHaveBeenCalled()
  await expect(requestPersonalTransfer({ token: 'rice-token', to: ' receiver ', amount: 12, memo: '  谢谢  ', clientRequestId: 'gift-key' })).resolves.toEqual(receipt)
  const [url, init] = fetch.mock.calls[0]
  expect(url).toMatch(/\/api\/grain_transfers$/)
  expect(init.headers.Authorization).toBe('Bearer rice-token')
  expect(JSON.parse(init.body)).toEqual({ to: 'receiver', amount: 12, kind: 'gift', memo: '谢谢', client_request_id: 'gift-key' })
  for (const data of [{}, { ...receipt, amount: 1 }, { ...receipt, to: null }]) {
    fetch.mockResolvedValueOnce(Response.json({ data }))
    await expect(requestPersonalTransfer({ token: 'rice-token', to: 'receiver', amount: 12, clientRequestId: 'gift-key' })).rejects.toThrow('查看稻米记录')
  }
})
it('distinguishes returned frozen funds from settlement direction for both parties', () => {
  const entry = { id: 'receipt', kind: 'reserved', amount: 20, subject_uri: null, inserted_at: '', from_user: { id: 'lin', nickname: '林', handle: 'lin.test' }, to_user: { id: 'host', nickname: '周', handle: 'host.test' } } satisfies WalletEntry
  expect(walletEntryIncoming(entry, 'lin')).toBe(false)
  expect(walletEntryIncoming({ ...entry, kind: 'refunded' }, 'lin')).toBe(true)
  expect(walletEntryIncoming({ ...entry, kind: 'event_fee' }, 'lin')).toBe(false)
  expect(walletEntryIncoming({ ...entry, kind: 'event_fee' }, 'host')).toBe(true)
  const community = { ...entry, kind: 'community_fund' as const, to_user: null, to_node: { id: 'node', name: '社区' } }
  expect(walletEntryIncoming(community, 'lin')).toBe(false)
  expect(walletEntryIncoming(community, 'lin', 'node')).toBe(true)
  expect(walletEntryIncoming({ ...community, kind: 'task_reward', from_user: null, from_node: community.to_node, to_node: null, to_user: entry.from_user }, 'lin')).toBe(true)
})
