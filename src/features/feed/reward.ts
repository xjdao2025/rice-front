import { createServerFn } from '@tanstack/react-start'

import { backendData } from '~/lib/http'
import { credential, id, integer, object, text } from '~/lib/validation'
import type { RicePublicUser } from '~/lib/models'

type PostRewardInput = { token: string; to: string; amount: number; subjectUri: string; clientRequestId: string }
export type PostReward = { id: string; amount: number; to: Pick<RicePublicUser, 'id' | 'did' | 'handle' | 'nickname'> }

export async function requestPostReward(data: PostRewardInput) {
  if (!data.to.trim() || !data.subjectUri.startsWith('at://') || !Number.isSafeInteger(data.amount) || data.amount < 1) {
    throw new Error('请选择帖子作者并输入正整数稻米数量。')
  }
  const result = await backendData<PostReward>('/api/grain_transfers', {
    method: 'POST', token: data.token,
    json: { to: data.to.trim(), amount: data.amount, kind: 'reward', subject_uri: data.subjectUri, client_request_id: data.clientRequestId },
  })
  if (!result?.id || result.amount !== data.amount || !result.to?.id) {
    throw new Error('赞赏结果尚未确认，请先查看稻米明细。')
  }
  return result
}

export const sendPostReward = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, to: id, amount: integer(1, Number.MAX_SAFE_INTEGER), subjectUri: text(2048, 1), clientRequestId: text(128, 1) }))
  .handler(({ data }) => requestPostReward(data))
