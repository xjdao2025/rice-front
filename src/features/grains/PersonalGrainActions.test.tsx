import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import { defaultParseSearch } from '@tanstack/react-router'

const mock = vi.hoisted(() => ({
  recipient: vi.fn(), send: vi.fn(), session: null as RiceSession | null,
  stored: null as RiceSession | null, values: [] as unknown[], index: 0,
  parent: [] as unknown[], child: [] as unknown[], key: '', scanning: false,
  navigate: vi.fn(),
}))
vi.mock('./api', () => ({ findTransferRecipients: mock.recipient, sendPersonalGrains: mock.send }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: mock.session }), readStoredSession: () => mock.stored }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(), Link: () => null,
  createFileRoute: () => (options: unknown) => ({ options }),
  useMatch: () => mock.scanning ? {} : undefined,
  useNavigate: () => mock.navigate,
}))
vi.mock('~/features/social/UserProfilePage', () => ({ UserProfilePage: () => null }))
vi.mock('~/components/DetailDialog', () => ({ DetailDialog: () => null }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = mock.index++
    if (!(index in mock.values)) mock.values[index] = initial
    const values = mock.values
    return [values[index], (value: unknown) => { values[index] = value }]
  },
  useRef: (initial: unknown) => {
    const index = mock.index++
    return mock.values[index] ?? (mock.values[index] = { current: initial })
  },
  useEffect: (effect: () => void | (() => void)) => {
    const index = mock.index++
    if (!(index in mock.values)) mock.values[index] = { cleanup: effect() }
  },
}))

import { grainReceiveLink, PersonalGrainActions, ReceiveGrainPage, SendGrainPage } from './PersonalGrainActions'
import { renderToStaticMarkup } from 'react-dom/server'
import { Route } from '~/routes/profile.$actor.index'

const session = {
  token: 'rice-alice', user: { id: 'alice-id', handle: 'alice.example' },
  pds: { did: 'did:plc:alice', access_jwt: 'pds-alice' },
} as RiceSession
const recipient = { id: 'bob-id', did: 'did:plc:bob', handle: 'bob.example', nickname: 'Bob', avatar: null }
const receipt = { id: 'transfer-1', amount: 12, to: recipient }
const found = { exact: true, users: [recipient] }

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function cleanup() {
  for (const value of mock.child) {
    if (value && typeof value === 'object' && 'cleanup' in value && typeof value.cleanup === 'function') value.cleanup()
  }
}
function render() {
  mock.values = mock.parent; mock.index = 0
  const form = elements(SendGrainPage({})).find((node) => node.props.session)
  if (!form) return []
  const key = String(form.key)
  if (key !== mock.key) { cleanup(); mock.child = []; mock.key = key }
  mock.values = mock.child; mock.index = 0
  const props = form.props
  return elements((form.type as (value: typeof props) => ReactNode)(props))
}
const field = (label: string) => render().find((node) => node.props.label === label)?.props
const change = (label: string, value: string) => (field(label)!.onChange as (value: string) => void)(value)
const action = (label: string) => field(label)!.clickAction as () => Promise<void>
const confirmation = () => render().find((node) => node.props.title === '确认送稻米')
async function confirmRecipient(identifier = '@bob.example') {
  change('送给谁', identifier); change('送多少稻米', '12'); change('留言', '谢谢')
  await action('下一步')()
}

beforeEach(() => {
  mock.session = session; mock.stored = session
  mock.recipient.mockResolvedValue(found)
  mock.navigate.mockImplementation(async ({ to }: { to: string }) => { mock.scanning = to === '/me/grains/send/scan' })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://community.example' } }))
})
afterEach(() => {
  cleanup(); mock.values = []; mock.parent = []; mock.child = []; mock.key = ''
  mock.scanning = false; mock.navigate.mockReset(); mock.recipient.mockReset(); mock.send.mockReset(); vi.unstubAllGlobals()
})

it.each(['@bob.example', '13800138000'])('checks %s after input and writes the resolved id once while pending', async (identifier) => {
  change('送给谁', identifier); change('送多少稻米', '1.5')
  expect(field('下一步')?.isDisabled).toBe(true)
  await action('下一步')()
  expect(mock.recipient).not.toHaveBeenCalled()
  ;(field('送给谁')!.onBlur as () => void)()
  expect(mock.recipient).toHaveBeenCalledWith({ data: { token: 'rice-alice', identifier } })
  await vi.waitFor(() => expect(render().find((node) => node.props.role === 'status')).toBeDefined())
  change('送多少稻米', '12'); change('留言', '谢谢')
  await action('下一步')()
  expect(mock.recipient).toHaveBeenCalledTimes(1)
  expect(mock.send).not.toHaveBeenCalled()
  expect(confirmation()).toBeDefined()
  let finish!: (value: typeof receipt) => void
  mock.send.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  const confirm = action('确认送出')
  const pending = confirm()
  await confirm()
  expect(mock.send).toHaveBeenCalledTimes(1)
  expect(mock.send).toHaveBeenCalledWith({ data: { token: 'rice-alice', to: 'bob-id', amount: 12, memo: '谢谢', clientRequestId: expect.any(String) } })
  expect(field('确认送出')?.isDisabled).toBe(true)
  const closeConfirmation = confirmation()!.props.onClose as () => void
  closeConfirmation()
  expect(confirmation()).toBeDefined()
  expect(field('返回修改')?.isDisabled).toBe(true)
  finish(receipt); await pending
  expect(confirmation()).toBeUndefined()
  expect(render().find((node) => node.props.role === 'status')?.props.children).toEqual(['已送给 @', 'bob.example', ' ', 12, ' 稻米'])
})

it.each(['返回修改', '关闭或 Escape'])('returns from confirmation through %s with the form editable and values retained', async (close) => {
  await confirmRecipient()
  expect(field('送给谁')?.isDisabled).toBe(true)
  expect(field('下一步')).toBeUndefined()
  if (close === '返回修改') (field(close)!.onClick as () => void)()
  else (confirmation()!.props.onClose as () => void)()
  expect(confirmation()).toBeUndefined()
  expect(field('送给谁')?.isDisabled).toBe(false)
  expect(field('送给谁')?.value).toBe('@bob.example')
  expect(field('送多少稻米')?.value).toBe('12')
  expect(field('留言')?.value).toBe('谢谢')
  expect(field('下一步')?.isDisabled).toBe(false)
  expect(mock.send).not.toHaveBeenCalled()
})

it('reports an unknown phone after input and keeps the form editable', async () => {
  mock.recipient.mockRejectedValue(new Error('没找到这位伙伴，再核对一下账号。'))
  change('送给谁', '13800138000')
  ;(field('送给谁')!.onKeyDown as (event: unknown) => void)({ key: 'Enter', nativeEvent: { isComposing: true } })
  expect(mock.recipient).not.toHaveBeenCalled()
  ;(field('送给谁')!.onBlur as () => void)()
  await vi.waitFor(() => expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('没找到这位伙伴，再核对一下账号。'))
  ;(field('送给谁')!.onKeyDown as (event: unknown) => void)({ key: 'Enter', nativeEvent: { isComposing: false } })
  expect(mock.recipient).toHaveBeenCalledTimes(1)
  change('送多少稻米', '12')
  await action('下一步')()
  expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('没找到这位伙伴，再核对一下账号。')
  expect(mock.send).not.toHaveBeenCalled()
  expect(field('确认送出')).toBeUndefined()
  expect(field('送给谁')?.isDisabled).toBe(false)
})

it('lists candidates for an inexact name and sends to the one picked', async () => {
  const carol = { id: 'carol-id', did: 'did:plc:carol', handle: 'carol.example', nickname: 'Bob 的朋友', avatar: null }
  mock.recipient.mockResolvedValueOnce({ exact: false, users: [recipient, carol] })
  change('送给谁', 'bob'); change('送多少稻米', '12')
  await action('下一步')()
  expect(confirmation()).toBeUndefined()
  const options = () => render().filter((node) => node.props.role === 'option')
  expect(options()).toHaveLength(2)
  expect(elements(options()[1].props.children as ReactNode).some((node) => elements(node.props.detail as ReactNode).some((detail) => detail.props.children === 'did:plc:carol'))).toBe(true)
  ;(options()[1].props.onClick as () => void)()
  expect(options()).toHaveLength(0)
  expect(field('送给谁')?.value).toBe('carol.example')
  ;(field('送给谁')!.onBlur as () => void)()
  await action('下一步')()
  expect(mock.recipient).toHaveBeenCalledTimes(1)
  mock.send.mockResolvedValueOnce({ ...receipt, to: carol })
  await action('确认送出')()
  expect(mock.send).toHaveBeenCalledWith({ data: expect.objectContaining({ to: 'carol-id', amount: 12 }) })
})

it('reports no match when the search finds nobody', async () => {
  mock.recipient.mockResolvedValueOnce({ exact: false, users: [] })
  change('送给谁', '没有这个人')
  ;(field('送给谁')!.onBlur as () => void)()
  await vi.waitFor(() => expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('没找到这位伙伴，再核对一下账号。'))
})

it('checks a scanned recipient once before sending', async () => {
  change('送多少稻米', '12')
  ;(field('扫一扫')!.onClick as () => void)()
  const scanner = render().find((node) => typeof node.props.onRead === 'function')!
  ;(scanner.props.onRead as (value: string) => void)('13800138000')
  expect(mock.navigate).toHaveBeenLastCalledWith({ to: '/me/grains/send', search: {} })
  expect(field('送给谁')?.value).toBe('13800138000')
  expect(field('送多少稻米')?.value).toBe('12')
  expect(render().some((node) => typeof node.props.onRead === 'function')).toBe(false)
  expect(mock.recipient).toHaveBeenCalledWith({ data: { token: 'rice-alice', identifier: '13800138000' } })
  await vi.waitFor(() => expect(render().find((node) => node.props.role === 'status')).toBeDefined())
  ;(field('送给谁')!.onBlur as () => void)()
  expect(mock.recipient).toHaveBeenCalledTimes(1)
  expect(mock.send).not.toHaveBeenCalled()
})

it('reuses a blur lookup when the user immediately presses next', async () => {
  let finish!: (value: typeof found) => void
  mock.recipient.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  change('送给谁', '13800138000'); change('送多少稻米', '12')
  ;(field('送给谁')!.onBlur as () => void)()
  expect(field('下一步')?.isDisabled).toBe(false)
  const pending = action('下一步')()
  expect(mock.recipient).toHaveBeenCalledTimes(1)
  finish(found); await pending
  expect(confirmation()).toBeDefined()
})

it('ignores a recipient lookup after the identifier changes', async () => {
  let finish!: (value: typeof found) => void
  mock.recipient.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  change('送给谁', '13800138000')
  ;(field('送给谁')!.onBlur as () => void)()
  change('送给谁', '13900139000')
  finish(found); await Promise.resolve()
  expect(render().find((node) => node.props.role === 'status')).toBeUndefined()
  expect(field('送给谁')?.value).toBe('13900139000')
})

it('ignores a recipient lookup after switching accounts', async () => {
  let finish!: (value: typeof found) => void
  mock.recipient.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  change('送给谁', '13800138000')
  ;(field('送给谁')!.onBlur as () => void)()
  mock.session = { ...session, token: 'rice-carol' }; mock.stored = mock.session
  render()
  finish(found); await Promise.resolve()
  expect(render().find((node) => node.props.role === 'status')).toBeUndefined()
})

it('retries a failed send with the same request id, so it can only be debited once', async () => {
  await confirmRecipient()
  mock.send.mockRejectedValueOnce(new Error('Failed to fetch'))
  await action('确认送出')()
  // 网络失败不等于没送出:提示先查记录,再点确认仍用同一个标识
  expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('Failed to fetch 可能已经送出，改动前请先查看稻米记录。')
  await action('确认送出')()
  const ids = mock.send.mock.calls.map(([arg]) => arg.data.clientRequestId)
  expect(ids).toHaveLength(2)
  expect(ids[0]).toEqual(expect.any(String))
  expect(ids[1]).toBe(ids[0])
})

it('rejects transfers to self before any write', async () => {
  mock.recipient.mockResolvedValueOnce({ exact: true, users: [{ ...recipient, did: session.pds.did }] })
  await confirmRecipient()
  expect(render().find((node) => node.props.role === 'alert')?.props.children).toBe('不能送给自己。')
  expect(field('确认送出')).toBeUndefined()
  expect(mock.send).not.toHaveBeenCalled()
})

it('drops completed receipts on account change and ignores an old account response still pending', async () => {
  await confirmRecipient()
  mock.send.mockResolvedValueOnce(receipt)
  await action('确认送出')()
  expect(render().find((node) => node.props.role === 'status')).toBeDefined()
  mock.session = { ...session, token: 'rice-carol', pds: { ...session.pds, did: 'did:plc:carol' } }; mock.stored = mock.session
  expect(render().find((node) => node.props.role === 'status')).toBeUndefined()
  await confirmRecipient()
  let finish!: (value: typeof receipt) => void
  mock.send.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  const pending = action('确认送出')()
  mock.session = session; mock.stored = session
  render()
  const changed = vi.fn(); window.addEventListener('rice-changed', changed)
  finish(receipt); await pending
  expect(render().find((node) => node.props.role === 'status')).toBeUndefined()
  expect(field('送给谁')?.value).toBe('')
  expect(changed).not.toHaveBeenCalled()
})

it('keeps the QR receive link send flag after Router parses the query and rejects unknown values', () => {
  const did = 'did:plc:bob'
  const url = new URL(grainReceiveLink('https://community.example', did))
  expect(url.pathname).toBe(`/profile/${encodeURIComponent(did)}`)
  const search = defaultParseSearch(url.search)
  expect(search).toEqual({ send: 1 })
  const validate = Route.options.validateSearch as (search: Record<string, unknown>) => { send?: '1' }
  expect(validate(search)).toEqual({ send: '1' })
  expect(validate({ send: '1' })).toEqual({ send: '1' })
  for (const send of [undefined, null, true, 0, '0', 'true', 'other']) expect(validate({ send })).toEqual({})
})

it('shows the receiver avatar, nickname and handle centered under the QR code', () => {
  mock.session = { ...session, user: { ...session.user, nickname: '爱丽丝', avatar: { url: '/a.png' } } } as RiceSession
  const html = renderToStaticMarkup(<ReceiveGrainPage />)
  const card = html.slice(html.indexOf('grain-receive-card'), html.indexOf('请对方扫描'))
  expect(card).toContain('收稻米码')
  expect(card).toContain('class="avatar avatar--normal"')
  expect(card).toContain('<strong>爱丽丝</strong>')
  expect(card).toContain('@alice.example')
})

// 节点管理员在「我的 - 节点稻米」上也要有这两个按钮,指向节点的收 / 发页面
it('节点稻米账户上给出发放和接收两个按钮', () => {
  mock.session = session
  const html = renderToStaticMarkup(<PersonalGrainActions nodeId="3mtluow7pbfr5" />)
  expect(html).toContain('发放稻米')
  expect(html).toContain('/nodes/3mtluow7pbfr5/grains/send')
  expect(html).toContain('/nodes/3mtluow7pbfr5/grains/receive')
})

it('个人稻米账户上还是送稻米和接收稻米', () => {
  mock.session = session
  const html = renderToStaticMarkup(<PersonalGrainActions />)
  expect(html).toContain('/me/grains/send')
  expect(html).toContain('/me/grains/receive')
  expect(html).not.toContain('发放稻米')
})
