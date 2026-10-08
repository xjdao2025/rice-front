import { afterEach, expect, it, vi } from 'vitest'
import { requestPersonalTransfer, requestTransferRecipient, walletEntryIncoming, type WalletEntry } from './api'

afterEach(() => vi.unstubAllGlobals())
it('resolves phone and username recipients only through the authenticated Rice preview endpoint', async () => {
  const recipient = { id: 'receiver', did: 'did:plc:receiver', handle: 'receiver.example', nickname: '禾' }
  const fetch = vi.fn().mockImplementation(() => Response.json({ data: recipient }))
  vi.stubGlobal('fetch', fetch)
  for (const [identifier, to] of [[' 13800138000 ', '13800138000'], [' @receiver.example ', 'receiver.example']]) {
    expect(await requestTransferRecipient({ token: 'rice-token', identifier })).toEqual(recipient)
    const [url, init] = fetch.mock.calls.at(-1)!
    expect(url).toMatch(/\/api\/grain_transfers\/recipient$/)
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer rice-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) })
  }
})
it('sends personal gifts with Rice auth, rejects invalid amounts before transport and refuses incomplete receipts', async () => {
  const receipt = { id: 'gift-1', amount: 12, to: { id: 'receiver', did: 'did:plc:receiver', handle: 'receiver.example', nickname: '禾' } }
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: receipt }))
  vi.stubGlobal('fetch', fetch)
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(requestPersonalTransfer({ token: 'rice-token', to: 'receiver', amount })).rejects.toThrow('正整数')
  }
  await expect(requestPersonalTransfer({ token: 'rice-token', to: ' ', amount: 1 })).rejects.toThrow('接收人')
  expect(fetch).not.toHaveBeenCalled()
  await expect(requestPersonalTransfer({ token: 'rice-token', to: ' receiver ', amount: 12, memo: '  谢谢  ' })).resolves.toEqual(receipt)
  const [url, init] = fetch.mock.calls[0]
  expect(url).toMatch(/\/api\/grain_transfers$/)
  expect(init.headers.Authorization).toBe('Bearer rice-token')
  expect(JSON.parse(init.body)).toEqual({ to: 'receiver', amount: 12, kind: 'gift', memo: '谢谢' })
  for (const data of [{}, { ...receipt, amount: 1 }, { ...receipt, to: null }]) {
    fetch.mockResolvedValueOnce(Response.json({ data }))
    await expect(requestPersonalTransfer({ token: 'rice-token', to: 'receiver', amount: 12 })).rejects.toThrow('查看稻米明细')
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
