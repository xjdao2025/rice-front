import { expect, it } from 'vitest'
import { businessCopy } from './business-copy'

it('updates saved Rice system messages without changing node names', () => {
  expect(businessCopy('已向社区退回 20 稻米')).toBe('已向节点退还 20 稻米')
  expect(businessCopy('青禾社区 · 报名费 20 稻米已退回')).toBe('青禾社区 · 报名的 20 稻米已退还')
})
