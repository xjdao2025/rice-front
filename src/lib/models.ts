export type RiceUser = {
  id: string
  did: string
  handle: string
  nickname: string | null
  bio: string | null
  avatar: null | { id: string; kind: string; filename: string; content_type: string; byte_size: number; url: string }
  grain_balance: number
  grain_frozen_balance: number
  node_member: boolean
  can_publish_tasks: boolean
  email: string | null
  phone: string | null
  phone_region: string | null
  wallet_address: string | null
  inserted_at: string
}

export type RiceAttachment = NonNullable<RiceUser['avatar']>
export type HistorySnapshot = Record<string, string | number | string[] | null>
// avatar 只要 url：rice 没有头像时会用 AppView 的（withProfileAvatars），那种没有附件记录
export type RicePublicUser = Pick<RiceUser, 'id' | 'did' | 'handle' | 'nickname' | 'bio' | 'node_member'> & { avatar: { url: string } | null }

export type RiceSession = {
  token: string
  user: RiceUser
  pds: { service: string; did: string; handle: string; access_jwt: string; refresh_jwt: string }
}

export type PostCategory = 'post' | 'activity' | 'product'

export type PostImage = { src: string; fullsize?: string; alt: string; width?: number; height?: number }

type AspectRatio = { width: number; height: number }
type StrongRef = { uri: string; cid: string }

export type PdsImage = {
  image: { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number }
  alt: string
  aspectRatio?: AspectRatio
}

type PostImageEmbed = {
  $type: string
  images?: Array<PdsImage | { thumb: string; fullsize: string; alt: string; aspectRatio?: AspectRatio }>
  items?: Array<PdsImage & { $type: 'app.bsky.embed.gallery#image' }>
}
type PostEmbed = PostImageEmbed & { media?: PostImageEmbed }

type Author = { did: string; handle: string; displayName?: string; avatar?: string }

export type PostView = {
  uri: string
  cid: string
  indexedAt: string
  author: Author
  record: {
    text: string
    createdAt: string
    xjdaoCategory?: PostCategory
    embed?: PostEmbed
    reply?: { root: StrongRef; parent: StrongRef }
  }
  embed?: PostEmbed
  images?: PostImage[]
  replyCount: number
  repostCount: number
  likeCount: number
  viewer?: { like?: string; repost?: string }
  reason?: {
    $type: 'app.bsky.feed.defs#reasonRepost'
    by: Omit<Author, 'avatar'>
    uri?: string
    cid?: string
    indexedAt: string
  }
}

export type PostFeed = { posts: PostView[]; cursor?: string | null }

export type PostThread = { post: PostView; replies: Array<{ post: PostView; parentUri: string }> }

export type NotificationView = {
  uri: string
  author: Omit<Author, 'did' | 'avatar'> & { did?: string }
  reason: string
  reasonSubject?: string
  recordSubjectUri?: string
  text: string
  isRead: boolean
  indexedAt: string
  taskId?: string
  subjectType?: string
  subjectId?: string
}

export type SocialProfile = {
  socialAvailable?: boolean
  did: string
  handle: string
  displayName?: string
  description?: string
  avatar?: string
  followersCount: number
  followsCount: number
  postsCount: number
  viewer?: { following?: string; followedBy?: string }
}

export type SocialConnectionPage = { subject: SocialProfile; profiles: SocialProfile[]; cursor?: string }
