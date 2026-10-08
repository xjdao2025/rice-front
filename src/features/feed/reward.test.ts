import { afterEach, expect, it, vi } from 'vitest'

import { requestPostReward } from './reward'

afterEach(() => vi.unstubAllGlobals())

it('uses one Rice reward transfer linked to the post and validates the receipt', async () => {
  const receipt = { id: 'reward-1', amount: 3, to: { id: 'author', did: 'did:plc:author', handle: 'author.test', nickname: '作者' } }
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: receipt }))
  vi.stubGlobal('fetch', fetch)
  const input = { token: 'rice-token', to: 'did:plc:author', amount: 3, subjectUri: 'at://did:plc:author/app.bsky.feed.post/abc' }
  await expect(requestPostReward(input)).resolves.toEqual(receipt)
  const [url, init] = fetch.mock.calls[0]
  expect(url).toMatch(/\/api\/grain_transfers$/)
  expect(init.headers.Authorization).toBe('Bearer rice-token')
  expect(JSON.parse(init.body)).toEqual({ to: input.to, amount: 3, kind: 'reward', subject_uri: input.subjectUri })

  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(requestPostReward({ ...input, amount })).rejects.toThrow('正整数')
  }
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockResolvedValueOnce(Response.json({ data: { id: 'reward-2', amount: 3 } }))
  await expect(requestPostReward(input)).rejects.toThrow('查看稻米明细')
})
