import { Button } from '@astryxdesign/core/Button'
import { TextArea } from '~/components/AutoTextArea'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'

import { ContentCardHeader } from '~/components/ContentCardHeader'
import { LoadingState } from '~/components/LoadingState'
import { ImageGroup } from '~/components/ContentImages'
import { PostCard } from '~/components/PostList'
import { PostText } from '~/components/PostText'
import { PostActions } from '~/components/PostActions'
import { authorDisplayName, formatTimestamp } from '~/lib/format'
import type { PostThread, PostView } from '~/lib/models'
import { MAX_POST_TEXT_LENGTH } from '~/lib/pds'

import { useStoredSession } from '../session/session'
import { PostRewardDialog } from './PostRewardDialog'
import {
  clearCachedFeed,
  createdPostView,
  createReply,
  loadCachedThread,
  readCachedThread,
  readRememberedPost,
  writeCachedThread,
} from './api'
import {
  ACTIVITY_PARTICIPATION_TEXT,
  formatPostFieldValue,
  POST_CATEGORIES,
  postCategory,
  postFieldValues,
} from './tags'

type PostThreadPanelProps = {
  uri: string
  focusReply?: boolean
  initialThread?: PostThread | null
  initialError?: string
}

export function PostThreadPanel(props: PostThreadPanelProps) {
  const { session } = useStoredSession()
  return <PostThreadContent key={`${props.uri}:${session?.user.id ?? 'guest'}`} {...props} />
}

function PostThreadContent({
  uri,
  focusReply = false,
  initialThread,
  initialError = '',
}: PostThreadPanelProps) {
  const { session, isReady } = useStoredSession()
  const navigate = useNavigate()
  const [thread, setThread] = useState<PostThread | null>(() => initialThread ?? readCachedThread(uri, session?.pds.did))
  const [error, setError] = useState(initialError)
  const [replyText, setReplyText] = useState('')
  const [replyTo, setReplyTo] = useState<PostView | null>(null)
  const [replyNotice, setReplyNotice] = useState('')
  const [isReplying, setReplying] = useState(false)
  const [rewardOpen, setRewardOpen] = useState(false)
  const focusRequested = useRef(false)
  const replyComposerId = useId()
  const shownPost = thread?.post ?? readRememberedPost(uri, session?.pds.did)
  const category = thread ? postCategory(thread.post.record) : 'post'
  const fields = thread ? postFieldValues(thread.post.record.text, category) : {}
  const participants = thread?.replies.filter(
    (reply) => reply.parentUri === thread.post.uri && reply.post.record.text === ACTIVITY_PARTICIPATION_TEXT,
  ) ?? []
  const hasParticipated = Boolean(
    session && participants.some((reply) => reply.post.author.did === session.pds.did),
  )
  const participationClosed = Boolean(
    fields.deadline && new Date(fields.deadline).getTime() <= Date.now(),
  )

  useEffect(() => {
    if (!isReady) return
    if (!uri) { setError('帖子不存在'); return }
    if (thread || initialError) return
    let active = true
    setError('')
    loadCachedThread({
      uri,
      accessJwt: session?.pds.access_jwt,
      did: session?.pds.did,
    })
      .then((next) => {
        if (!active) return
        setThread(next)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '帖子暂时无法显示')
      })
    return () => { active = false }
  }, [isReady, session?.pds.access_jwt, session?.pds.did, thread, uri, initialError])

  useEffect(() => {
    if ((!focusReply && !focusRequested.current) || !thread) return
    focusRequested.current = false
    window.requestAnimationFrame(() => {
      const composer = document.getElementById(replyComposerId)
      composer?.scrollIntoView({ block: 'end' })
      composer?.querySelector('textarea')?.focus()
    })
  }, [focusReply, replyComposerId, thread])

  const focusComposer = (target: PostView | null = null) => {
    setReplyTo(target)
    setReplyNotice('')
    if (!thread) focusRequested.current = true
    const composer = document.getElementById(replyComposerId)
    composer?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    composer?.querySelector('textarea')?.focus()
  }

  const publishComment = async (text: string, target: PostView | null) => {
    if (!session || !thread) return
    const subject = { uri: thread.post.uri, cid: thread.post.cid }
    const reply = { root: subject, parent: target ? { uri: target.uri, cid: target.cid } : subject }
    const result = await createReply({
      data: {
        did: session.pds.did,
        accessJwt: session.pds.access_jwt,
        text,
        ...reply,
      },
    })
    const post = createdPostView(result, session, reply)
    const nextThread = {
      ...thread,
      post: {
        ...thread.post,
        replyCount: (thread.post.replyCount ?? 0) + (target ? 0 : 1),
      },
      replies: [
        ...thread.replies.map((item) => target?.uri === item.post.uri
          ? { ...item, post: { ...item.post, replyCount: (item.post.replyCount ?? 0) + 1 } }
          : item),
        { post, parentUri: reply.parent.uri },
      ],
    }
    setThread(nextThread)
    clearCachedFeed(session.pds.did)
    writeCachedThread(nextThread, session.pds.did)
  }

  const submitComment = async (
    text: string,
    successMessage: string,
    failureMessage: string,
    target: PostView | null = null,
  ) => {
    setReplying(true)
    setReplyNotice('')
    try {
      await publishComment(text, target)
      setReplyNotice(successMessage)
      return true
    } catch (reason) {
      setReplyNotice(reason instanceof Error ? reason.message : failureMessage)
      return false
    } finally {
      setReplying(false)
    }
  }

  const submitReply = async () => {
    if (!session || !thread || !replyText.trim()) return
    if (await submitComment(replyText, '评论已发布。', '评论失败', replyTo)) {
      setReplyText('')
      setReplyTo(null)
    }
  }

  const participate = async () => {
    if (!session || !thread || hasParticipated || participationClosed) return
    await submitComment(ACTIVITY_PARTICIPATION_TEXT, '已参与活动。', '参与失败')
  }

  return (
    <div className="post-thread-panel">
      {error ? <div className="form-error">{error}</div> : null}
      {shownPost ? (
        <PostCard
          post={shownPost}
          detail
          commentCount={thread?.replies.length}
          onOpenComments={() => focusComposer()}
          onPostDeleted={() => { void navigate({ to: '/' }) }}
        />
      ) : !error ? <LoadingState label="正在加载帖子…" /> : null}
      {thread && (category === 'post' ? (
            <section className="reply-section" aria-label="评论">
              {session && <div className="reply-composer" id={replyComposerId}>
                {replyTo && <div className="reply-composer-target"><span>回复 {authorDisplayName(replyTo.author)}</span><Button label="取消回复" variant="ghost" size="sm" onClick={() => setReplyTo(null)} /></div>}
                <TextArea
                  label={replyTo ? `回复 ${authorDisplayName(replyTo.author)}` : '写下评论'}
                  isLabelHidden
                  value={replyText}
                  onChange={setReplyText}
                  maxLength={MAX_POST_TEXT_LENGTH}
                  width="100%"
                  placeholder="写下你的评论…"
                  hasAutoFocus={focusReply}
                />
                {replyNotice && <p className="reply-composer-notice" role="status">{replyNotice}</p>}
                <div className="form-actions">
                  {thread.post.author.did !== session.pds.did && <Button label="赞赏稻米" variant="ghost" onClick={() => setRewardOpen(true)} />}
                  <Button
                    label="发布评论"
                    variant="primary"
                    clickAction={submitReply}
                    isLoading={isReplying}
                    isDisabled={!replyText.trim() || replyText.length > MAX_POST_TEXT_LENGTH}
                  />
                </div>
              </div>}

              <div className="business-heading"><h2>评论 <span>{thread.replies.length}</span></h2></div>
              {session && rewardOpen && <PostRewardDialog post={thread.post} session={session} onClose={() => setRewardOpen(false)} />}
              {thread.replies.length > 0 && (
                <div className="reply-list">
                  {thread.replies.filter((reply) => reply.parentUri === thread.post.uri).map((reply) => (
                    <div className="reply-thread" key={reply.post.uri}>
                      <CommentRow post={reply.post} onReply={() => focusComposer(reply.post)} />
                      {thread.replies.filter((child) => child.parentUri === reply.post.uri).map((child) => (
                        <CommentRow key={child.post.uri} post={child.post} repliedTo={authorDisplayName(reply.post.author)} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section
              className="special-post-details"
              aria-label={`${POST_CATEGORIES[category].label}信息`}
            >
              {POST_CATEGORIES[category].fields.map((field) => (
                <div key={field.key}>
                  <span>{field.label}</span>
                  <strong>{formatPostFieldValue(field.key, fields[field.key])}</strong>
                </div>
              ))}
              {session && category === 'activity' ? (
                <div className="activity-participation">
                  <span>{participants.length} 人已参与</span>
                  <Button
                    label={participationClosed ? '活动已截止' : hasParticipated ? '已参与' : '参与活动'}
                    variant="primary"
                    clickAction={participate}
                    isLoading={isReplying}
                    isDisabled={participationClosed || hasParticipated}
                  />
                  <em role="status">{replyNotice}</em>
                </div>
              ) : null}
            </section>
          ))}
    </div>
  )
}

function CommentRow({ post, onReply, repliedTo }: { post: PostView; onReply?: () => void; repliedTo?: string }) {
  return <article className={`reply-row${repliedTo ? ' reply-row-child' : ''}`}>
    <ContentCardHeader name={authorDisplayName(post.author)} timestamp={formatTimestamp(post.record.createdAt || post.indexedAt)} profileActor={post.author.did} avatarUrl={post.author.avatar} />
    {repliedTo && <p className="reply-parent">回复 {repliedTo}</p>}
    <p><PostText text={post.record.text} /></p>
    <ImageGroup images={(post.images ?? []).map((image) => ({ ...image, src: image.fullsize ?? image.src }))} />
    <PostActions post={post} onOpenComments={onReply} commentAction={repliedTo ? 'hidden' : 'reply'} />
  </article>
}
