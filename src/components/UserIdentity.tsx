import type { ReactNode } from 'react'

import { Avatar } from '~/components/Avatar'
import type { RicePublicUser } from '~/lib/models'

/**
 * 用户列表里一行的身份部分：头像、昵称（可带标签）、@handle，外层的链接 / 按钮由调用方给。
 * 没有昵称时名字就是 handle，不再重复一行。
 */
export function UserIdentity({ user, badge, detail }: { user: Pick<RicePublicUser, 'handle' | 'nickname' | 'avatar'>; badge?: ReactNode; detail?: ReactNode }) {
  const name = user.nickname || user.handle
  return <>
    <Avatar name={name} src={user.avatar?.url} />
    <span className="person-copy user-identity">
      <strong><span>{name}</span>{badge}</strong>
      {user.nickname && <small>@{user.handle}</small>}
      {detail}
    </span>
  </>
}
