import { Button } from '@astryxdesign/core/Button'
import { useEffect, useRef, useState } from 'react'
import { AutoLoadMore } from '~/components/AutoLoadMore'
import { TextArea } from '~/components/AutoTextArea'
import { ContentCardHeader } from '~/components/ContentCardHeader'
import { LoadingState } from '~/components/LoadingState'
import { formatTimestamp } from '~/lib/format'
import { LoginLink } from '../session/LoginLink'
import { readStoredSession, useStoredSession } from '../session/session'
import { getProposalComments, postProposalComment, type GovernancePage, type ProposalComment } from './api'
import './proposal-comments.css'

const MAX_COMMENT_LENGTH = 512

export function ProposalComments({ proposalId }: { proposalId: string }) {
  const { session, isReady } = useStoredSession()
  const token = session?.token
  const [page, setPage] = useState<GovernancePage<ProposalComment> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  const paging = useRef(false)
  const sending = useRef(false)

  useEffect(() => {
    const version = ++request.current
    setPage(null)
    setLoading(true)
    setError('')
    void getProposalComments({ data: { id: proposalId } })
      .then((next) => { if (version === request.current) setPage(next) })
      .catch((reason: Error) => { if (version === request.current) setError(reason.message) })
      .finally(() => { if (version === request.current) setLoading(false) })
    return () => { ++request.current; paging.current = false }
  }, [proposalId, revision])

  const loadMore = async () => {
    const before = page?.meta.next_cursor
    if (!before || paging.current) return
    const version = request.current
    paging.current = true
    setLoading(true)
    setError('')
    try {
      const next = await getProposalComments({ data: { id: proposalId, before } })
      if (version === request.current) setPage((current) => current && ({
        data: [...new Map([...current.data, ...next.data].map((comment) => [comment.id, comment])).values()],
        meta: next.meta,
      }))
    } catch (reason) {
      if (version === request.current) setError(reason instanceof Error ? reason.message : '评论加载失败。')
    } finally {
      if (version === request.current) { paging.current = false; setLoading(false) }
    }
  }

  const submit = async () => {
    const body = draft.trim()
    if (!token || !page || !body || body.length > MAX_COMMENT_LENGTH || sending.current || readStoredSession()?.token !== token) return
    const version = request.current
    sending.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      const created = await postProposalComment({ data: { id: proposalId, token, body } })
      if (version !== request.current || readStoredSession()?.token !== token) return
      setPage((current) => current && ({ ...current, data: [created, ...current.data.filter((item) => item.id !== created.id)] }))
      setDraft('')
    } catch (reason) {
      if (version === request.current && readStoredSession()?.token === token) setSubmitError(reason instanceof Error ? reason.message : '评论发布失败。')
    } finally {
      sending.current = false
      setSubmitting(false)
    }
  }

  return <section className="business-section reply-section proposal-comments" aria-label="提案评论">
    <h2>评论</h2>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!page && (error ? <Button label="重试" variant="secondary" onClick={() => setRevision((value) => value + 1)} /> : <LoadingState label="正在加载评论…" />)}
    {page && page.data.length > 0 && <div className="reply-list">
      {page.data.map((comment) => <article className="reply-row" key={comment.id}>
        <ContentCardHeader name={comment.author?.nickname || comment.author?.handle || '用户'} profileActor={comment.author?.did} avatarUrl={comment.author?.avatar?.url} timestamp={formatTimestamp(comment.inserted_at)} />
        <p>{comment.body}</p>
      </article>)}
    </div>}
    {page?.meta.next_cursor && <AutoLoadMore cursor={page.meta.next_cursor} loading={loading} failed={!!error} onLoadMore={loadMore} />}
    {isReady && (session ? <div className="reply-composer">
      <TextArea label="评论内容" isLabelHidden value={draft} onChange={setDraft} maxLength={MAX_COMMENT_LENGTH} width="100%" placeholder="发表你的评论…" isDisabled={submitting} />
      {submitError && <p className="inline-error" role="alert">{submitError}</p>}
      <div className="form-actions"><Button label="发表评论" variant="primary" clickAction={submit} isLoading={submitting} isDisabled={!page || !draft.trim() || draft.length > MAX_COMMENT_LENGTH || submitting} /></div>
    </div> : <LoginLink className="primary-link">登录后发表评论</LoginLink>)}
  </section>
}
