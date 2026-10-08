import { createServerFn } from '@tanstack/react-start'

import { BACKEND_BASE, requestJson } from '~/lib/http'
import type { RicePublicUser } from '~/lib/models'

type PostRewardInput = { token: string; to: string; amount: number; subjectUri: string }
export type PostReward = { id: string; amount: number; to: Pick<RicePublicUser, 'id' | 'did' | 'handle' | 'nickname'> }

export async function requestPostReward(data: PostRewardInput) {
  if (!data.to.trim() || !data.subjectUri.startsWith('at://') || !Number.isSafeInteger(data.amount) || data.amount < 1) {
    throw new Error('请选择帖子作者并输入正整数稻米数量。')
  }
  const result = (await requestJson<{ data: PostReward }>(`${BACKEND_BASE}/api/grain_transfers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: data.to.trim(), amount: data.amount, kind: 'reward', subject_uri: data.subjectUri }),
  })).data
  if (!result?.id || result.amount !== data.amount || !result.to?.id) {
    throw new Error('赞赏结果尚未确认，请先查看稻米明细。')
  }
  return result
}

export const sendPostReward = createServerFn({ method: 'POST' })
  .validator((data: PostRewardInput) => data)
  .handler(({ data }) => requestPostReward(data))
