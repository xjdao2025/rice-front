import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { DetailDialog } from '~/components/DetailDialog'
import { RequestError } from '~/lib/http'
import { integerInputError } from '~/lib/integer-input'
import type { PostView, RiceSession } from '~/lib/models'

import { readStoredSession } from '../session/session'
import { sendPostReward, type PostReward } from './reward'

export function PostRewardDialog({ post, session, onClose }: { post: PostView; session: RiceSession; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<PostReward | null>(null)
  const pending = useRef(false)
  const recipient = post.author.displayName && post.author.displayName !== post.author.handle
    ? post.author.displayName : `@${post.author.handle}`
  const amountError = amount ? integerInputError(amount, '赞赏稻米数量', 1) : null
  const close = () => { if (!pending.current) onClose() }
  const send = async () => {
    if (pending.current || uncertain || !amount || amountError) return
    if (!confirming) { setError(''); setConfirming(true); return }
    if (readStoredSession()?.token !== session.token) { setError('登录状态已变化，请重新打开赞赏。'); return }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await sendPostReward({ data: { token: session.token, to: post.author.did, amount: Number(amount), subjectUri: post.uri } })
      window.dispatchEvent(new Event('rice-changed'))
      setReceipt(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '赞赏失败。')
      // Rice transfers have no client idempotency key. A failed response may follow a successful debit.
      setUncertain(!(reason instanceof RequestError && reason.status >= 400 && reason.status < 500))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <DetailDialog title="赞赏稻米" className="post-dialog business-dialog compose-close-dialog" onClose={close}>
    <div className="business-panel form-stack">
      {receipt ? <><strong role="status">已向 @{receipt.to.handle} 赞赏 {receipt.amount} 稻米</strong><Link to="/me/grains">查看稻米明细</Link><div className="form-actions"><Button label="完成" variant="primary" onClick={close} /></div></> : <>
        <p>{confirming ? `向 ${recipient} 赞赏 ${amount} 稻米？` : `赞赏给 ${recipient}`}</p>
        {!confirming && <TextInput label="赞赏稻米数量" value={amount} onChange={setAmount} status={amountError ? { type: 'error', message: amountError } : undefined} width="100%" />}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {uncertain ? <p role="alert">请先<Link to="/me/grains">查看稻米明细</Link>，确认未扣除稻米后再重新赞赏。</p> : <div className="form-actions">
          {confirming && <Button label="返回修改" variant="secondary" isDisabled={busy} onClick={() => setConfirming(false)} />}
          <Button label={confirming ? '确认赞赏' : '下一步'} variant="primary" isLoading={busy} isDisabled={busy || !amount || !!amountError} clickAction={send} />
        </div>}
      </>}
    </div>
  </DetailDialog>
}
