import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { backendData } from '~/lib/http'
import { credential, object } from '~/lib/validation'

type Wallet = {
  point_id: string
  name: string
  status: string
  wallet_status: string
  available: string
  held: string
  earned: string
}

const getWallets = createServerFn({ method: 'POST' })
  .validator(object({ token: credential }))
  .handler(({ data }) => backendData<Wallet[]>('/api/point-wallets', { token: data.token }))

export function PointWallets({ token }: { token: string }) {
  const [wallets, setWallets] = useState<Wallet[]>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void getWallets({ data: { token } }).then(
      (data) => { if (active) setWallets(data) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [token, attempt])

  return <section className="grain-card" aria-labelledby="point-wallet-heading">
    <h2 id="point-wallet-heading">我的积分</h2>
    {failed ? <p role="alert">无法加载积分余额。 <button type="button" onClick={() => { setFailed(false); setAttempt(attempt + 1) }}>重试</button></p>
      : !wallets ? <p role="status">正在加载积分余额…</p>
      : wallets.length === 0 ? <p>你还没有积分钱包。</p>
      : <ul className="point-wallet-list">{wallets.map((wallet) => <li key={wallet.point_id}>
        <header><strong>{wallet.name}</strong></header>{wallet.status !== 'active' || wallet.wallet_status !== 'active' ? '（未启用）' : ''}
        <div className="grain-balance-row">
          <strong>{(BigInt(wallet.available) + BigInt(wallet.held)).toLocaleString('zh-CN')}</strong>
        </div>
        <div className="grain-metrics">
          <div><b>{BigInt(wallet.available).toLocaleString('zh-CN')}</b><span>可用</span></div>
          <div><b>{BigInt(wallet.held).toLocaleString('zh-CN')}</b><span>冻结积分</span></div>
          <div><b>{BigInt(wallet.earned).toLocaleString('zh-CN')}</b><span>累计获得</span></div>
        </div>
      </li>)}</ul>}
  </section>
}
