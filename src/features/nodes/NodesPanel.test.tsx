import { Children, isValidElement, type ReactElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import type { CommunityNode } from './api'

const mock = vi.hoisted(() => ({ session: { token: 'token' } as RiceSession | null, apply: vi.fn(), navigate: vi.fn(), values: [] as unknown[], index: 0 }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: mock.session }) }))
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), applyToNode: mock.apply }))
vi.mock('@tanstack/react-router', async (original) => ({ ...await original<typeof import('@tanstack/react-router')>(), useNavigate: () => mock.navigate }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = mock.index++
  if (!(index in mock.values)) mock.values[index] = initial
  return [mock.values[index], (value: unknown) => { mock.values[index] = value }]
} }))

import { NodeListRow } from './NodesPanel'

afterEach(() => vi.unstubAllGlobals())

it('applies from the list without opening details and prevents repeated or unavailable applications', async () => {
  const node = { id: 'node-1', name: '测试节点', description: '详情中的简介', owner: { id: 'owner' }, role: null, my_application: null } as CommunityNode
  const row = (value = node) => { mock.index = 0; return NodeListRow({ node: value }) }
  const children = (value = node) => Children.toArray(row(value).props.children).filter(isValidElement) as ReactElement<Record<string, any>>[]
  const actions = (value = node) => Children.toArray(children(value)[1].props.children).filter(isValidElement) as ReactElement<Record<string, any>>[]
  const button = (value = node) => actions(value).find((child) => 'clickAction' in child.props)!
  const dispatched = vi.fn()
  vi.stubGlobal('window', { dispatchEvent: dispatched })
  mock.apply.mockResolvedValue({ ...node, my_application: { id: 'application-1', status: 'pending' } })

  expect(row().type).toBe('li')
  expect(children()).toHaveLength(2)
  expect(button().props.label).toBe('申请加入')
  expect(children()[0].props.to).toBe('/nodes/$nodeId')
  expect(actions()[1].props.label).toBe('查看介绍')
  await button().props.clickAction()
  expect(mock.apply).toHaveBeenCalledExactlyOnceWith({ data: { token: 'token', nodeId: 'node-1', reason: '' } })
  expect(dispatched.mock.calls[0][0].type).toBe('rice-changed')
  expect(button().props.label).toBe('申请中')
  await button().props.clickAction()
  expect(mock.apply).toHaveBeenCalledOnce()
  expect(mock.navigate).not.toHaveBeenCalled()
  actions()[1].props.onClick()
  expect(mock.navigate).toHaveBeenCalledWith({ to: '/nodes/$nodeId', params: { nodeId: 'node-1' } })
  const rejected = { ...node, my_application: { id: 'application-1', status: 'rejected' } } as CommunityNode
  expect(button(rejected).props.label).toBe('申请加入')
  expect(button(rejected).props.isDisabled).toBe(false)

  for (const [value, label] of [[{ ...node, role: 'member' }, '已加入'], [{ ...node, my_application: { status: 'pending' } }, '申请中'], [{ ...node, owner: null }, '暂未开放']] as const) {
    mock.values = []
    expect(button(value as CommunityNode).props.label).toBe(label)
    expect(button(value as CommunityNode).props.isDisabled).toBe(true)
    await button(value as CommunityNode).props.clickAction()
  }
  mock.values = []; mock.session = null
  expect(actions()[0].props.children).toBe('申请加入')
  expect(actions()[0].props.className).toBe('primary-link')
  expect(mock.apply).toHaveBeenCalledOnce()
})
