import { useEffect, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ConfirmDialog } from '~/components/ConfirmDialog'
import { errorMessage } from '~/lib/util'
import { useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import { getPointWallets, type PointWallet } from './wallet-api'
import { listPaymentApps, registerPaymentApp, revealPaymentCredential, rotatePaymentCredential, type PaymentApp } from './payment-apps-api'

export function PaymentAppsPage() {
  const { session, isReady } = useStoredSession()
  if (!isReady) return <p role="status">正在加载…</p>
  if (!session) return <LoginLink className="primary-link">登录后注册支付应用</LoginLink>
  return <PaymentAppsContent key={session.token} token={session.token} handle={session.user.handle} />
}

function PaymentAppsContent({ token, handle }: { token: string; handle: string }) {
  const [apps, setApps] = useState<PaymentApp[]>([])
  const [wallets, setWallets] = useState<PointWallet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [pointId, setPointId] = useState('')
  const [returnUrl, setReturnUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void Promise.all([listPaymentApps({ data: { token } }), getPointWallets({ data: { token } })]).then(([registered, owned]) => {
      if (!active) return
      const available = owned.filter(w => w.status === 'active' && w.wallet_status === 'active')
      setApps(registered); setWallets(available)
      setPointId(current => available.some(w => w.point_id === current) ? current : available[0]?.point_id ?? '')
    }).catch(e => { if (active) setError(errorMessage(e, '无法加载应用，请重试。')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, version])

  async function register() {
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const result = await registerPaymentApp({ data: { token, pointId, name: name.trim(), returnUrl: returnUrl.trim() } })
      setApps(current => [result, ...current])
      setName(''); setReturnUrl('')
    } catch (e) { setError(errorMessage(e, '注册未确认成功，请刷新应用列表核对后再重试。')) }
    finally { submitting.current = false; setBusy(false) }
  }

  let validUrl = false
  try {
    const url = new URL(returnUrl.trim())
    validUrl = url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch { /* The form stays disabled until a complete HTTPS address is entered. */ }

  return <div className="page business-panel form-stack">
    <h1>积分支付应用</h1>
    <p>注册第三方应用后，使用 RICE_PAYMENT_KEY 创建支付订单，并让用户在 Rice 收银台确认付款。</p>
    <section className="business-section form-stack">
      <h2>注册收款应用</h2>
      <p>收款账号为 @{handle}，请选择用于收款的积分。</p>
      <TextInput label="应用名称" value={name} onChange={setName} isDisabled={busy || loading} width="100%" />
      <label className="native-field">收款积分
        <select value={pointId} onChange={e => setPointId(e.target.value)} disabled={busy || loading}>
          {!wallets.length && <option value="">没有可用的积分钱包</option>}
          {wallets.map(wallet => <option key={wallet.point_id} value={wallet.point_id}>{wallet.name}</option>)}
        </select>
      </label>
      <TextInput label="HTTPS 返回地址" value={returnUrl} onChange={setReturnUrl} isDisabled={busy || loading} width="100%" />
      <p className="muted">付款后由用户返回此地址，商户服务端查单后交付。</p>
      <Button label={busy ? '正在注册…' : '注册应用'} variant="primary" isDisabled={busy || loading || !pointId || !name.trim() || name.trim().length > 255 || returnUrl.trim().length > 2048 || !validUrl} clickAction={register} />
    </section>
    {error && <p role="alert">{error}</p>}
    <header className="payment-app-list-heading"><h2>我的应用</h2><Button label="刷新应用列表" variant="ghost" isDisabled={loading || busy} onClick={() => setVersion(v => v + 1)} /></header>
    {loading && <p role="status">正在加载应用…</p>}
    {!loading && !apps.length && <p>还没有注册的应用。</p>}
    {apps.map(app => <PaymentAppCard key={app.id} app={app} token={token} pointName={wallets.find(w => w.point_id === app.point_id)?.name ?? app.point_id} />)}
    <a href="https://github.com/xjdao2025/rice/tree/codex/rice-point-migration/developer/point-integration" target="_blank" rel="noreferrer">支付集成指南与 OpenAPI</a>
  </div>
}

function PaymentAppCard({ app, token, pointName }: { app: PaymentApp; token: string; pointName: string }) {
  const [secret, setSecret] = useState('')
  const [stored, setStored] = useState(app.credential_stored)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const pending = useRef(false)

  useEffect(() => { setStored(app.credential_stored) }, [app.credential_stored])

  useEffect(() => {
    const hide = () => { if (document.hidden) { setSecret(''); setCopied(false) } }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  async function loadCredential(rotate = false) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setSecret(''); setCopied(false)
    try {
      const result = await (rotate ? rotatePaymentCredential : revealPaymentCredential)({ data: { token, appId: app.id } })
      setSecret(result.credential); setStored(true); setConfirm(false)
    } catch (e) { setError(errorMessage(e, '无法读取密钥，请重试。')) }
    finally { pending.current = false; setBusy(false) }
  }

  return <section className="grain-card form-stack">
    <h3>{app.name}{!app.active && '（已停用）'}</h3>
    <dl className="payment-app-details">
      <dt>应用 ID</dt><dd>{app.id}</dd>
      <dt>收款积分</dt><dd>{pointName}</dd>
      <dt>积分 ID</dt><dd>{app.point_id}</dd>
      <dt>收款钱包 ID</dt><dd>{app.payee_account_id}</dd>
      <dt>返回地址</dt><dd>{app.return_url}</dd>
    </dl>
    <strong>RICE_PAYMENT_KEY</strong>
    {!stored && <p>此旧应用未保存可恢复的密钥。重置后可重复查看，旧密钥会立即失效。</p>}
    {secret ? <>
      <code className="payment-app-secret">{secret}</code>
      <div className="form-actions">
        <Button label={copied ? '已复制' : '复制密钥'} variant="primary" onClick={() => { void navigator.clipboard.writeText(secret).then(() => setCopied(true), () => setError('复制失败，请手动复制。')) }} />
        <Button label="隐藏密钥" variant="secondary" onClick={() => { setSecret(''); setCopied(false) }} />
      </div>
      <p className="muted">将密钥保存到应用服务端环境变量。请妥善保管，避免分享给他人。</p>
    </> : stored && <Button label={busy ? '正在读取…' : '查看密钥'} variant="secondary" isDisabled={busy} onClick={() => void loadCredential()} />}
    <Button label="重置密钥" variant="ghost" isDisabled={busy} onClick={() => setConfirm(true)} />
    {error && <p role="alert">{error}</p>}
    {confirm && <ConfirmDialog title="重置支付密钥" busy={busy} error={error} back="返回" confirm="确认重置" variant="destructive" onClose={() => setConfirm(false)} onConfirm={() => loadCredential(true)}>旧密钥会立即失效。重置后，请更新所有调用此应用支付接口的服务端配置。</ConfirmDialog>}
  </section>
}
