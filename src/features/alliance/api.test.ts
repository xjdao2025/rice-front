import { afterEach, expect, it, vi } from 'vitest'

import { loadAnnouncement, loadAnnouncements, loadFoundation, loadGovernanceBody, loadGrainGrants, loadProposal, loadProposalComments, loadProposals, sendProposalComment, sendProposalVote } from './api'

afterEach(() => vi.unstubAllGlobals())

it('reads public grain issuance records from the Rice ledger', async () => {
  const page = { data: [{ id: 'grant-1', amount: 20, memo: '节点发放', to: null, to_node: { id: 'node-1', name: '测试节点' }, inserted_at: '2026-10-08T00:00:00Z' }], meta: { next_cursor: 'older', total_granted: 120 } }
  const fetch = vi.fn().mockResolvedValue(Response.json(page))
  vi.stubGlobal('fetch', fetch)
  expect(await loadGrainGrants({ before: 'cursor/1' })).toEqual(page)
  const [url, init] = fetch.mock.calls[0]
  expect(new URL(url).pathname).toBe('/api/grain_grants')
  expect(new URL(url).searchParams.get('before')).toBe('cursor/1')
  expect(init?.headers).toBeUndefined()
})

it('reads public foundation and announcements from Rice, preserving the list cursor and nullable attachment', async () => {
  const foundation = { fund_scale: 1000, issued_grain_scale: 250, proposal_approval_votes: 10, documents: [] }
  const announcement = { id: 'announcement-1', title: '公告', position: 0, attachment: null, inserted_at: '2026-09-27T00:00:00Z' }
  const page = { data: [announcement], meta: { next_cursor: 'older' } }
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: foundation }))
    .mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json({ data: announcement }))
  vi.stubGlobal('fetch', fetch)
  expect(await loadFoundation()).toEqual(foundation)
  expect(await loadAnnouncements({ before: 'cursor/1', limit: 12 })).toEqual(page)
  expect(await loadAnnouncement({ id: 'announcement/1' })).toEqual(announcement)
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
    '/api/settings/foundation', '/api/announcements', '/api/announcements/announcement%2F1',
  ])
  expect(Object.fromEntries(new URL(fetch.mock.calls[1][0]).searchParams)).toEqual({ before: 'cursor/1', limit: '12' })
  expect(fetch.mock.calls.every(([, init]) => !init?.headers?.Authorization)).toBe(true)
})

it('preserves proposal filters and paging while requesting the current Rice user vote only with Rice auth', async () => {
  const proposal = { id: 'proposal-1', status: 'open', my_vote: 'oppose', agree_count: 2, oppose_count: 3, total_votes: 5, attachment: null, author: null }
  const page = { data: [proposal], meta: { next_cursor: null } }
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json(page))
    .mockResolvedValueOnce(Response.json({ data: proposal }))
  vi.stubGlobal('fetch', fetch)
  expect(await loadProposals({})).toEqual(page)
  expect(await loadProposals({ token: 'rice-token', status: 'open', before: 'older', limit: 8 })).toEqual(page)
  expect(await loadProposal({ id: 'proposal/1', token: 'rice-token' })).toEqual(proposal)
  expect(fetch.mock.calls[0][1].headers).toBeUndefined()
  expect(Object.fromEntries(new URL(fetch.mock.calls[1][0]).searchParams)).toEqual({ status: 'open', before: 'older', limit: '8' })
  expect(new URL(fetch.mock.calls[2][0]).pathname).toBe('/api/proposals/proposal%2F1')
  for (const [, init] of fetch.mock.calls.slice(1)) expect(init.headers).toEqual({ Authorization: 'Bearer rice-token' })
})

it.each(['agree', 'oppose'] as const)('sends one %s vote with the exact Rice payload and returns the stored vote', async (choice) => {
  const vote = { choice, inserted_at: '2026-09-27T00:00:00Z' }
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: vote }, { status: 201 }))
  vi.stubGlobal('fetch', fetch)
  expect(await sendProposalVote({ id: 'proposal/1', token: 'rice-token', choice })).toEqual(vote)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = fetch.mock.calls[0]
  expect(new URL(url).pathname).toBe('/api/proposals/proposal%2F1/vote')
  expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer rice-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) })
})

it('preserves a rejected vote without retrying or reporting success', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ errors: { detail: '投票已结束' } }, { status: 422 }))
  vi.stubGlobal('fetch', fetch)
  await expect(sendProposalVote({ id: 'proposal-1', token: 'rice-token', choice: 'agree' })).rejects.toThrow('投票已结束')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('loads public proposal comments and publishes with the current Rice token', async () => {
  const comment = { id: 'comment-1', body: '支持', author: null, inserted_at: '2026-10-08T00:00:00Z' }
  const page = { data: [comment], meta: { next_cursor: 'older' } }
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json({ data: comment }, { status: 201 }))
  vi.stubGlobal('fetch', fetch)
  expect(await loadProposalComments({ id: 'proposal/1', before: 'cursor/1' })).toEqual(page)
  expect(await sendProposalComment({ id: 'proposal/1', token: 'rice-token', body: '支持' })).toEqual(comment)
  const [listUrl, listOptions] = fetch.mock.calls[0]
  expect(new URL(listUrl).pathname).toBe('/api/proposals/proposal%2F1/comments')
  expect(new URL(listUrl).searchParams.get('before')).toBe('cursor/1')
  expect(listOptions?.headers).toBeUndefined()
  const [publishUrl, publishOptions] = fetch.mock.calls[1]
  expect(new URL(publishUrl).pathname).toBe('/api/proposals/proposal%2F1/comments')
  expect(publishOptions).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer rice-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ body: '支持' }) })
})

it('reads attachment text only from the fixed Rice path and refuses URL or path input before transport', async () => {
  const html = '<p>公告正文</p>'
  const fetch = vi.fn().mockResolvedValueOnce(new Response(html, { headers: { 'Content-Type': 'text/html', 'Content-Disposition': 'attachment' } }))
  vi.stubGlobal('fetch', fetch)
  for (const id of ['', '..', '../proposals', 'https://other.example/body', 'body?redirect=1']) {
    await expect(loadGovernanceBody({ id })).rejects.toThrow('正文附件无效')
  }
  expect(fetch).not.toHaveBeenCalled()
  expect(await loadGovernanceBody({ id: 'attachment-1' })).toBe(html)
  expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/api/attachments/attachment-1')
  expect(fetch.mock.calls[0][1]).toBeUndefined()
  fetch.mockResolvedValueOnce(Response.json({ errors: { detail: '附件不存在' } }, { status: 404 }))
  await expect(loadGovernanceBody({ id: 'missing' })).rejects.toThrow('附件不存在')
})

it('keeps historical download images on the current origin without changing other URLs', async () => {
  // Public proposal 3mtluoyohsnr5 and the next historical image retain their original GUID query strings.
  const legacy = '<div><img src="http://xjdao.xyz/api/v1/file/download?fileId=27110018f04343b4836d8f529bb4676f&fileType=1"><img src="https://xjdao.xyz/api/v1/file/download?fileId=9368fed9e4074b06afb9b558690a8b7b&fileType=1"></div>'
  const normalized = '<div><img src="/api/v1/file/download?fileId=27110018f04343b4836d8f529bb4676f&fileType=1"><img src="/api/v1/file/download?fileId=9368fed9e4074b06afb9b558690a8b7b&fileType=1"></div>'
  const unchanged = '<img src="/api/v1/file/download?fileId=27110018f04343b4836d8f529bb4676f&fileType=1"><img src="https://outside.example/photo.png"><a href="https://outside.example/page">链接</a>'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(legacy + unchanged, { headers: { 'Content-Type': 'text/plain' } })))
  expect(await loadGovernanceBody({ id: '3mtlulxprser5' })).toBe(normalized + unchanged)
})
