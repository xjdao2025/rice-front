import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { LoginLink } from '~/features/session/LoginLink'
import { useStoredSession } from '~/features/session/session'
import { confirmPointCheckout, getPointCheckout, type CheckoutDetails } from '~/features/points/checkout'
import { RequestError } from '~/lib/http'

export const Route = createFileRoute('/point-checkout/$checkoutToken')({
  component: PointCheckout,
})

function PointCheckout() {
  const { checkoutToken } = Route.useParams()
  const { session } = useStoredSession()

  if (!session) return <LoginLink className="primary-link">登录后确认付款</LoginLink>
  return <CheckoutForm key={JSON.stringify([checkoutToken, session.token])} checkoutToken={checkoutToken} token={session.token} />
}

function CheckoutForm({ checkoutToken, token }: { checkoutToken: string; token: string }) {
  const [order, setOrder] = useState<CheckoutDetails>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    let active = true
    void getPointCheckout({ data: { token, checkoutToken } }).then(
      (details) => { if (active) setOrder(details) },
      () => { if (active) setError('无法读取订单，请检查链接后重试。') },
    )
    return () => { active = false }
  }, [checkoutToken, token])

  async function confirm() {
    if (submitting.current || order?.status !== 'pending') return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await confirmPointCheckout({ data: { token, checkoutToken } })
      setOrder({ ...order, ...result })
    } catch (reason) {
      const current = await getPointCheckout({ data: { token, checkoutToken } }).catch(() => undefined)
      if (current) setOrder(current)
      if (current?.status !== 'succeeded') {
        setError(reason instanceof RequestError && reason.code === 'insufficient_balance'
          ? '可用积分不足。'
          : '暂未确认付款成功，请核对订单状态后重试。')
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <section aria-labelledby="point-checkout-heading">
    <h1 id="point-checkout-heading">确认积分付款</h1>
    {!order && !error && <p role="status">正在读取订单…</p>}
    {order && <>
      <dl>
        <dt>应用</dt><dd>{order.app_name}</dd>
        <dt>收款方</dt><dd>{order.payee_name}</dd>
        <dt>付款金额</dt><dd>{order.amount} {order.point_name ?? order.point_code}</dd>
      </dl>
      {order.status === 'pending' && <button type="button" disabled={busy} onClick={() => void confirm()}>
        {busy ? '正在确认…' : '确认付款'}
      </button>}
      {order.status === 'succeeded' && <p role="status">付款成功。</p>}
      {order.status === 'expired' && <p role="status">订单已过期。</p>}
      {order.status === 'canceled' && <p role="status">订单已取消。</p>}
      <a href={order.return_url} rel="noreferrer">返回应用</a>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
