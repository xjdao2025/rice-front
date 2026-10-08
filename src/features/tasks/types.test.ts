import { describe, expect, it } from 'vitest'

import { myTaskGroup, taskDisplayStatus, taskEventLabel, type RiceTask, type TaskEvent } from './types'

const event = (overrides: Partial<TaskEvent>): TaskEvent => ({
  id: 'event-1',
  from_status: 'open',
  to_status: 'in_progress',
  detail: null,
  actor: null,
  inserted_at: '2026-09-03T00:00:00Z',
  ...overrides,
})

describe('task labels', () => {
  it('stops showing recruitment at the deadline while keeping cancelled tasks cancelled', () => {
    const task = { status: 'open', application_deadline: '2026-09-21T09:00:00Z' } as const
    const deadline = Date.parse(task.application_deadline)
    expect(taskDisplayStatus(task, deadline - 1)).toBe('招募中')
    expect(taskDisplayStatus(task, deadline)).toBe('已失效')
    expect(taskDisplayStatus({ ...task, application_closed: true }, deadline - 1)).toBe('申请已截止')
    expect(taskDisplayStatus({ ...task, application_deadline: null }, deadline)).toBe('招募中')
    expect(taskDisplayStatus({ ...task, appointed_count: 1 }, deadline)).toBe('招募中')
    expect(taskDisplayStatus({ ...task, assignees: [{ did: 'worker' }] } as RiceTask, deadline)).toBe('招募中')
    expect(taskDisplayStatus({ ...task, status: 'cancelled' }, deadline)).toBe('已取消')
    expect(taskDisplayStatus({ ...task, status: 'expired' }, deadline)).toBe('已失效')
    expect(taskDisplayStatus({ ...task, status: 'overdue' }, deadline)).toBe('已超时')
    expect(taskDisplayStatus({ ...task, status: 'under_review' }, deadline)).toBe('待验收')
  })

  it('describes user actions without exposing state-machine transitions', () => {
    expect(taskEventLabel(event({ from_status: 'draft', to_status: 'open' }))).toBe('发布任务')
    expect(taskEventLabel(event({}))).toBe('选定承接者')
    expect(taskEventLabel(event({ from_status: 'under_review' }))).toBe('退回修改')
    expect(taskEventLabel(event({ from_status: 'in_progress' }))).toBe('更新任务进展')
    expect(taskEventLabel(event({ to_status: 'overdue' }))).toBe('交付超时')
    expect(taskEventLabel(event({ to_status: 'expired' }))).toBe('任务已失效')
  })

  it('shows an unsubmitted delivery as overdue at its deadline while review stays pending', () => {
    const task = { status: 'in_progress', application_deadline: null, execution_deadline: '2026-09-21T09:00:00Z' } as const
    const deadline = Date.parse(task.execution_deadline)
    expect(taskDisplayStatus(task, deadline - 1)).toBe('进行中')
    expect(taskDisplayStatus(task, deadline)).toBe('已超时')
    expect(taskDisplayStatus({ ...task, status: 'under_review' }, deadline)).toBe('待验收')
    expect(taskDisplayStatus({ ...task, execution_deadline: null }, deadline)).toBe('进行中')
  })
})

it('keeps candidate decisions separate from delivery and terminal task states', () => {
  const task = { status: 'in_progress', my_application_status: 'not_selected', application_count: 2, allowed_actions: ['appoint', 'reject_application'] } as RiceTask
  expect(myTaskGroup(task, false)).toBe('not_selected')
  expect(myTaskGroup({ ...task, status: 'completed' }, false)).toBe('not_selected')
  expect(myTaskGroup({ ...task, status: 'open', my_application_status: 'pending' }, true)).toBe('open')
  expect(myTaskGroup({ ...task, status: 'open', my_application_status: 'pending' }, false)).toBe('applying')
  expect(myTaskGroup({ ...task, status: 'under_review', my_application_status: 'appointed' }, false)).toBe('under_review')
  expect(myTaskGroup({ ...task, status: 'overdue', my_application_status: 'appointed' }, false)).toBe('overdue')
  expect(myTaskGroup({ ...task, status: 'open', my_application_status: 'appointed', my_status: 'in_progress' }, false)).toBe('in_progress')
  expect(myTaskGroup({ ...task, status: 'under_review', my_application_status: 'appointed', my_status: 'in_progress', execution_deadline: '2026-09-21T09:00:00Z' }, false)).toBe('overdue')
  expect(myTaskGroup({ ...task, status: 'open', my_application_status: 'appointed', my_status: 'under_review' }, true)).toBe('open')
  expect(myTaskGroup({ ...task, status: 'open', my_application_status: 'pending', my_status: 'open' }, false)).toBe('applying')
  expect(myTaskGroup({ ...task, status: 'in_progress', my_application_status: 'pending', my_status: 'in_progress' }, false)).toBe('applying')
  for (const status of ['completed', 'expired', 'cancelled'] as const) {
    expect(myTaskGroup({ ...task, status, my_application_status: 'appointed' }, false)).toBe(status)
  }
})

it('returns an open task to recruitment after all applications have been rejected', () => {
  const task = { status: 'open', my_application_status: 'not_selected', application_count: 2, allowed_actions: ['cancel'] } as RiceTask
  expect(myTaskGroup(task, true)).toBe('open')
  expect(myTaskGroup(task, false)).toBe('not_selected')
})

it('moves an unappointed open task to expired as soon as its application deadline passes', () => {
  const deadline = Date.parse('2026-09-21T09:00:00Z')
  const task = { status: 'open', application_deadline: '2026-09-21T09:00:00Z', my_application_status: 'pending' } as RiceTask
  expect(myTaskGroup(task, true, deadline - 1)).toBe('open')
  expect(myTaskGroup(task, true, deadline)).toBe('expired')
  expect(myTaskGroup(task, false, deadline)).toBe('expired')
  expect(myTaskGroup({ ...task, application_deadline: null }, true, deadline)).toBe('open')
})

it('moves unsubmitted work to overdue at delivery deadline without moving review', () => {
  const deadline = Date.parse('2026-09-21T09:00:00Z')
  const task = { status: 'in_progress', execution_deadline: '2026-09-21T09:00:00Z', my_application_status: 'appointed' } as RiceTask
  expect(myTaskGroup(task, false, deadline - 1)).toBe('in_progress')
  expect(myTaskGroup(task, false, deadline)).toBe('overdue')
  expect(myTaskGroup({ ...task, status: 'under_review' }, false, deadline)).toBe('under_review')
  expect(myTaskGroup({ ...task, execution_deadline: null }, false, deadline)).toBe('in_progress')
})

it.each(['appoint', 'reject_application'] as const)('keeps a publisher task recruiting while %s is allowed', (action) => {
  const task = { status: 'open', my_application_status: null, application_count: 2, allowed_actions: [action, 'cancel'] } as RiceTask
  expect(myTaskGroup(task, true)).toBe('open')
})
