import { expect, it } from 'vitest'
import { businessCopy } from './business-copy'

it('updates saved Rice system messages without changing node names', () => {
  expect(businessCopy('已向社区退回 20 稻米')).toBe('已向节点退还 20 稻米')
  expect(businessCopy('青禾社区 · 报名费 20 稻米已退回')).toBe('青禾社区 · 报名的 20 稻米已退回')
  expect(businessCopy('邻里 · 春游 · 活动申请已通过')).toBe('邻里 · 春游 · 报名通过')
  expect(businessCopy('收款人不存在')).toBe('没找到这位伙伴，再核对一下账号。')
  expect(businessCopy('任务奖励核对')).toBe('任务奖励核对')
})
