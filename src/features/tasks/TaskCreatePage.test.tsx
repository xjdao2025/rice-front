import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import type { CommunityNode } from '../nodes/api'
import type { RiceTask } from './types'

const captured = vi.hoisted(() => ({ props: null as null | {
  steps: Array<{ label: string; title: string; content: ReactNode; review: ReactNode }>
  validate: (step: number) => string | null
} }))
vi.mock('~/components/PublishSteps', () => ({ PublishSteps: (props: typeof captured.props) => { captured.props = props; return null }, usePublishValidationAttempted: () => false }))

import { TaskCreatePage } from './TaskCreatePage'

function renderTask(applicationDeadline: string | null, executionDeadline: string | null, contact = 'contact', editing = false, status: RiceTask['status'] = 'draft', capacity = 1) {
  const draft = {
    id: 'task-1', node: { id: 'node-1', name: '社区', logo: null }, title: '任务', description: '说明',
    requirement: '要求', organizer_contact: contact, reward_amount: 1, capacity, attachments: [], status,
    application_deadline: applicationDeadline, execution_deadline: executionDeadline,
  } as unknown as RiceTask
  renderToStaticMarkup(<TaskCreatePage session={{ token: 'token' } as RiceSession} nodes={[{ id: 'node-1', name: '社区' } as CommunityNode]} initialDraft={draft} editing={editing} onPublished={() => undefined} onCloseStateChange={() => undefined} />)
  return captured.props!
}

it('gives each required task deadline its own step and validates them separately', () => {
  const empty = renderTask(null, null)
  expect(empty.steps.map(step => step.label)).toEqual(['基本信息', '内容', '申请截止', '最晚交成果', '参与与稻米'])
  expect((empty.steps[2].content as ReactElement<{ fields: unknown }>).props.fields).toEqual([expect.objectContaining({ label: '申请截止', required: true })])
  expect((empty.steps[3].content as ReactElement<{ fields: unknown }>).props.fields).toEqual([expect.objectContaining({ label: '最晚交成果', required: true })])
  expect(empty.validate(2)).toContain('请选择申请截止')
  expect(empty.validate(3)).toBe('选一下最晚哪天交成果。')
  expect(renderTask(null, null, '').validate(0)).toContain('组织方联系方式')

  const ordered = renderTask('2099-01-01T10:00:00+08:00', '2099-01-02T10:00:00+08:00')
  expect(ordered.validate(2)).toBeNull()
  expect(ordered.validate(3)).toBeNull()
  expect(renderTask('2099-01-02T10:00:00+08:00', '2099-01-01T10:00:00+08:00').validate(3)).toBe('交成果时间要晚于申请截止。')
})

it('allows unchanged past deadlines when editing an active task', () => {
  const edit = renderTask('2020-01-01T10:00:00+08:00', '2020-01-02T10:00:00+08:00', 'contact', true, 'open')
  expect(edit.validate(2)).toBeNull()
  expect(edit.validate(3)).toBeNull()
})

it('requires a future application deadline before reopening a cancelled or expired task', () => {
  for (const status of ['cancelled', 'expired'] as const) {
    expect(renderTask('2020-01-01T10:00:00+08:00', '2020-01-02T10:00:00+08:00', 'contact', true, status).validate(2)).toContain('晚于当前时间')
    expect(renderTask('2099-01-01T10:00:00+08:00', '2099-01-02T10:00:00+08:00', 'contact', true, status).validate(2)).toBeNull()
  }
})

it('restores capacity and explains the single or multiple reward before publishing', () => {
  const single = renderTask(null, null)
  const singleCapacity = renderToStaticMarkup(single.steps[1].content)
  const singleReward = renderToStaticMarkup(single.steps[4].content)
  const singleReview = renderToStaticMarkup(single.steps[4].review)
  expect(singleCapacity).toContain('复杂任务')
  expect(singleCapacity).toContain('只需一人承接')
  expect(singleCapacity).toContain('简单')
  expect(singleCapacity).toContain('多人分别完成')
  expect(singleCapacity).toContain('单人任务')
  expect(singleCapacity).not.toContain('承接人数上限（必填）')
  expect(single.steps[4].title).toBe('给多少稻米？')
  expect(singleReward).toContain('稻米激励（测试稻米）')
  expect(singleReview).toContain('1 测试稻米')
  expect(singleReview).toContain('稻米从哪出')
  expect(singleReward).toContain('使用节点稻米，不扣个人稻米。')
  expect(singleReview).not.toContain('× 1')

  const multiple = renderTask(null, null, 'contact', false, 'draft', 3)
  const field = renderToStaticMarkup(multiple.steps[1].content)
  expect(field).toContain('承接人数上限')
  expect(field).toContain('value="3"')
  expect(field).toContain('每人独立交付')
  expect(field).toContain('验收')
  expect(renderToStaticMarkup(multiple.steps[1].review)).toContain('最多 3 人')
  expect(multiple.steps[4].title).toBe('给每位承接者多少稻米？')
  expect(renderToStaticMarkup(multiple.steps[4].content)).toContain('每人稻米激励（测试稻米）')
  expect(renderToStaticMarkup(multiple.steps[4].review)).toContain('1 × 3 = 3 测试稻米')
  expect(renderTask(null, null, 'contact', false, 'draft', 1001).validate(1)).toContain('2～1000')
})

it('keeps capacity and per-person reward read-only for an active task, but editable when reopening', () => {
  const active = renderTask(null, null, 'contact', true, 'open', 3)
  expect(renderToStaticMarkup(active.steps[1].content)).toMatch(/<select[^>]*disabled/)
  expect(renderToStaticMarkup(active.steps[4].content)).toMatch(/<input[^>]*readOnly/)
  const cancelled = renderTask(null, null, 'contact', true, 'cancelled', 3)
  expect(renderToStaticMarkup(cancelled.steps[1].content)).not.toMatch(/<select[^>]*disabled/)
  expect(renderToStaticMarkup(cancelled.steps[4].content)).not.toMatch(/<input[^>]*readOnly/)
})

it('locks the community selector only while editing an active task', () => {
  const select = (status: RiceTask['status']) => renderToStaticMarkup(renderTask(null, null, 'contact', true, status).steps[0].content as unknown as ReactNode).match(/<select[^>]*>/)?.[0]
  expect(select('open')).toContain('disabled')
  expect(select('cancelled')).not.toContain('disabled')
})
