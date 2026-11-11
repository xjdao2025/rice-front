import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { QrCode, ScanLine } from 'lucide-react'
import { PersonalGrainActions } from '../grains/PersonalGrainActions'
import { getPointWallets, type PointWallet } from './wallet-api'

export function PointWallets({ token }: { token: string }) {
  const [wallets, setWallets] = useState<PointWallet[]>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void getPointWallets({ data: { token } }).then(
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
        <header><strong>{wallet.name}</strong><Button label="积分记录" variant="ghost" href={wallet.is_rice ? '/me/grains' : `/me/points/${wallet.point_id}`}>积分记录 →</Button></header>{wallet.status !== 'active' || wallet.wallet_status !== 'active' ? '（未启用）' : ''}
        <div className="grain-balance-row">
          <strong>{(BigInt(wallet.available) + BigInt(wallet.held)).toLocaleString('zh-CN')}</strong>
          {wallet.is_rice ? <PersonalGrainActions /> : <div className="personal-grain-actions">
            <Button label="送积分" variant="ghost" href={`/me/points/${wallet.point_id}?mode=send`}><span className="grain-action-content"><span className="grain-action-icon"><ScanLine size={22} /></span><span>送积分</span></span></Button>
            <Button label="接收积分" variant="ghost" href={`/me/points/${wallet.point_id}?mode=receive`}><span className="grain-action-content"><span className="grain-action-icon"><QrCode size={22} /></span><span>接收积分</span></span></Button>
          </div>}
        </div>
        <div className="grain-metrics">
          <div><b>{BigInt(wallet.available).toLocaleString('zh-CN')}</b><span>可用</span></div>
          <div><b>{BigInt(wallet.held).toLocaleString('zh-CN')}</b><span>冻结积分</span></div>
          <div><b>{BigInt(wallet.earned).toLocaleString('zh-CN')}</b><span>累计获得</span></div>
        </div>
      </li>)}</ul>}
  </section>
}
