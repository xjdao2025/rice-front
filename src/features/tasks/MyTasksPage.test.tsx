import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import type { RiceTask } from './types'

const mock = vi.hoisted(() => ({ session: null as RiceSession | null, values: [] as unknown[], index: 0 }))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: mock.session, isReady: true }) }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))
vi.mock('~/components/useTimeBoundary', () => ({ useTimeBoundary: () => Date.parse('2026-10-13T00:00:00Z') }))
vi.mock('@astryxdesign/core/Selector', () => ({ Selector: () => null }))
vi.mock('./TaskCard', () => ({ TaskCard: () => null }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = mock.index++
    if (!(index in mock.values)) mock.values[index] = initial
    return [mock.values[index], (value: unknown) => { mock.values[index] = value }]
  },
}))

import { Selector } from '@astryxdesign/core/Selector'
import { TaskCard } from './TaskCard'
import { MyTasksPage } from './MyTasksPage'

function task(id: string, status: RiceTask['status'], extra: Partial<RiceTask> = {}): RiceTask {
  return { id, title: id, status, creator: { id: 'alice' }, application_deadline: null, execution_deadline: null, ...extra } as RiceTask
}
const tasks = [
  task('review-own', 'under_review'),
  task('review-assigned', 'in_progress', { creator: { id: 'bob' } as RiceTask['creator'], my_application_status: 'appointed', my_status: 'under_review' }),
  task('completed-own', 'completed'),
  task('open-own', 'open'),
]
const initialData = { accountId: 'alice', sessionToken: 'alice-token', tasks }

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function render(props: Parameters<typeof MyTasksPage>[0] = { initialData, loaderToken: 'alice-token' }) {
  mock.index = 0
  return elements(MyTasksPage(props))
}
function selector(tree: ReturnType<typeof render>) {
  return tree.find(node => node.type === Selector)!.props as {
    value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void
  }
}
const cards = (tree: ReturnType<typeof render>) => tree.filter(node => node.type === TaskCard).map(node => node.props.task as RiceTask)

beforeEach(() => {
  mock.session = { token: 'alice-token', user: { id: 'alice' } } as RiceSession
  mock.values = []
})

it('keeps all task counts and filters with the library selector, including an assignee’s own status', () => {
  let tree = render()
  expect(selector(tree).value).toBe('all')
  expect(selector(tree).options).toContainEqual({ value: 'all', label: '全部 4' })
  expect(selector(tree).options).toContainEqual({ value: 'under_review', label: '待验收 2' })
  expect(cards(tree).map(value => value.id)).toEqual(tasks.map(value => value.id))

  selector(tree).onChange('under_review')
  tree = render()
  expect(selector(tree).value).toBe('under_review')
  expect(cards(tree).map(value => [value.id, value.status])).toEqual([['review-own', 'under_review'], ['review-assigned', 'under_review']])
  expect(selector(tree).options).toContainEqual({ value: 'all', label: '全部 4' })

  selector(tree).onChange('all')
  tree = render()
  expect(selector(tree).value).toBe('all')
  expect(cards(tree)).toHaveLength(4)
})

it.each([
  { accountId: 'bob', sessionToken: 'alice-token' },
  { accountId: 'alice', sessionToken: 'stale-token' },
])('does not show cached task rows from another account or token: $accountId / $sessionToken', (owner) => {
  const tree = render({ initialData: { ...initialData, ...owner }, loaderToken: 'alice-token' })
  expect(cards(tree)).toEqual([])
  expect(tree.some(node => node.type === Selector)).toBe(false)
})
