import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Link, useNavigate } from '@tanstack/react-router'
import { Repeat2 } from 'lucide-react'
import { useState } from 'react'

import { ContentCardHeader } from '~/components/ContentCardHeader'
import { ImageGroup } from '~/components/ContentImages'
import { PostText } from '~/components/PostText'
import { PostActions, type RepostChange } from '~/components/PostActions'
import { isPostHidden, rememberPost } from '~/features/feed/api'
import { useStoredSession } from '~/features/session/session'
import { postCategory, postDisplayText } from '~/features/feed/tags'
import { authorDisplayName, formatTimestamp } from '~/lib/format'
import type { PostView } from '~/lib/models'

export function PostList({
  posts,
  onRepostChange,
  onPostDeleted,
}: {
  posts: PostView[]
  onRepostChange?: (change: RepostChange) => void
  onPostDeleted?: (uri: string) => void
}) {
  const [deletedUris, setDeletedUris] = useState(() => new Set<string>())
  const visiblePosts = posts.filter(
    (post) => !deletedUris.has(post.uri) && !isPostHidden(post.uri),
  )

  if (visiblePosts.length === 0) {
    return (
      <div className="empty-panel">
        <EmptyState
          title="这里还没有帖子"
          description="分享见闻、想法和近况，让伙伴们看到。"
        />
      </div>
    )
  }

  return (
    <div className="post-list">
      {visiblePosts.map((post) => (
        <PostCard
          post={post}
          onRepostChange={onRepostChange}
          onPostDeleted={(uri) => {
            setDeletedUris((current) => new Set(current).add(uri))
            onPostDeleted?.(uri)
          }}
          key={post.reason?.uri ?? post.uri}
        />
      ))}
    </div>
  )
}

export function PostCard({
  post,
  detail = false,
  commentCount,
  onOpenComments,
  onRepostChange,
  onPostDeleted,
}: {
  post: PostView
  detail?: boolean
  commentCount?: number
  onOpenComments?: () => void
  onRepostChange?: (change: RepostChange) => void
  onPostDeleted?: (uri: string) => void
}) {
  const navigate = useNavigate()
  const { session } = useStoredSession()
  const category = postCategory(post.record)
  const openPost = () => {
    rememberPost(post, session?.pds.did)
    void navigate({ to: '/posts', search: { uri: post.uri } })
  }

  return (
    <article
      className={`content-card post-row ${category === 'post' ? '' : `${category}-post`}`}
      onClickCapture={detail ? undefined : () => rememberPost(post, session?.pds.did)}
    >
      {!detail && post.reason ? (
        <div className="post-reason">
          <Repeat2 size={14} aria-hidden="true" />
          <Link to="/profile/$actor" params={{ actor: post.reason.by.did }}>
            {authorDisplayName(post.reason.by)}
          </Link>
          转发了
        </div>
      ) : null}
      <ContentCardHeader
        name={authorDisplayName(post.author)}
        timestamp={formatTimestamp(post.record.createdAt || post.indexedAt)}
        profileActor={post.author.did}
        avatarUrl={post.author.avatar}
      />
      <p
        className={`post-copy${detail ? '' : ' post-copy-link'}`}
        role={detail ? undefined : 'link'}
        tabIndex={detail ? undefined : 0}
        onClick={detail ? undefined : openPost}
        onKeyDown={(event) => {
          if (detail) return
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPost()
          }
        }}
      >
        <PostText text={postDisplayText(post.record.text, category)} />
      </p>
      {post.images?.length ? <ImageGroup images={post.images} className="post-image-grid" /> : null}
      <PostActions
        post={post}
        commentCount={commentCount}
        onOpenComments={onOpenComments}
        onRepostChange={onRepostChange}
        onPostDeleted={onPostDeleted}
      />
    </article>
  )
}
