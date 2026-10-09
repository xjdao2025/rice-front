import { Button } from '@astryxdesign/core/Button'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, LogOut, Settings } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '~/components/Avatar'
import type { RiceUser } from '~/lib/models'
import { logoutRice } from '../session/api'
import { useStoredSession } from '../session/session'
import type { RiceWallet } from '../grains/api'
import { PersonalGrainActions } from '../grains/PersonalGrainActions'
export type ProfileInitialData = {
  accountId: string; sessionToken: string; user: RiceUser; wallet: RiceWallet
  communities?: Array<{ id: string; name: string; wallet: RiceWallet | null; error?: string }>
  communityError?: string
}

export function ProfilePage({ initialData = null, initialError = '' }: { initialData?: ProfileInitialData | null; initialError?: string }) {
  const { session, isReady, saveSession } = useStoredSession()
  const [communitySelection, setCommunitySelection] = useState<{ accountId: string; sessionToken: string; nodeId: string } | null>(null)
  const navigate = useNavigate()
  const logout = async () => { if (session) await logoutRice({ data: session.token }).catch(() => undefined); saveSession(null) }
  if (!isReady || !session) return null
  const current = initialData?.accountId === session.user.id && initialData.sessionToken === session.token ? initialData : null
  const profile = current?.user ?? session.user
  const communities = current?.communities ?? []
  const community = communitySelection?.accountId === session.user.id && communitySelection.sessionToken === session.token ? communities.find(({ id }) => id === communitySelection.nodeId) : undefined
  const wallet = community ? community.wallet : current?.wallet
  const selectCommunity = (nodeId: string) => setCommunitySelection({ accountId: session.user.id, sessionToken: session.token, nodeId })
  return <div className="page profile-page">
    <section className="profile-identity"><Link to="/me/settings" className="profile-identity-edit" aria-label="设置"><Settings size={20} /></Link>
      <Avatar name={profile.nickname || profile.handle} src={profile.avatar?.url} size="large" /><h1>{profile?.nickname || profile?.handle || '正在加载'}</h1><p>@{profile?.handle || '—'}</p>{profile?.bio && <p>{profile.bio}</p>}<div className="profile-public-action"><Button label="查看主页" variant="secondary" onClick={() => void navigate({ to: '/profile/$actor', params: { actor: profile.did || session.pds.did } })} /></div>
    </section>
    {initialError && <p className="inline-error" role="alert">{initialError}{current && ' 目前显示上次加载的数据。'}</p>}
    <section className="grain-card">
      <header>
        {communities.length ? (
          <div className="filter-buttons grain-wallet-tabs" role="group" aria-label="稻米账户">
            <Button label="我的测试稻米" variant="ghost" className={!community ? 'active' : undefined} aria-pressed={!community} onClick={() => setCommunitySelection(null)} />
            <Button label="节点稻米" variant="ghost" className={community ? 'active' : undefined} aria-pressed={!!community} onClick={() => selectCommunity(community?.id ?? communities[0].id)} />
          </div>
        ) : <span>我的测试稻米</span>}
        <Button label="稻米记录" variant="ghost" isDisabled={!wallet} onClick={() => community ? void navigate({ to: '/nodes/$nodeId/grains', params: { nodeId: community.id } }) : void navigate({ to: '/me/grains' })}>稻米记录 →</Button>
      </header>
      {community && (communities.length > 1 ? (
        <label className="native-field">管理的节点
          <select value={community.id} onChange={(event) => selectCommunity(event.target.value)}>
            {communities.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      ) : <p className="muted">{community.name}</p>)}
      {(community?.error || current?.communityError) && (
        <p className="inline-error" role="alert">{community?.error || current?.communityError}</p>
      )}
      <div className="grain-balance-row">
        <strong>{wallet ? wallet.balance + wallet.frozen : '—'}</strong>
        {!community && <PersonalGrainActions />}
      </div>
      <div className="grain-metrics">
        <div><b>{wallet?.balance ?? '—'}</b><span>可用</span></div>
        <div><b>{wallet?.frozen ?? '—'}</b><span>冻结稻米</span></div>
        <div><b>{wallet?.earned ?? '—'}</b><span>累计获得</span></div>
      </div>
    </section>
    <nav className="profile-menu" aria-label="个人中心功能">{([
      ['/me/identity', '节点身份', '我在各节点的身份'],
      ['/me/tasks', '我的任务', '申请、交付、验收与历史记录'],
      ['/me/events', '我的活动', '我申请 / 主办的活动'],
      ['/me/posts', '我的帖子', '在广场发布过的内容'],
    ] as const).map(([to, title, copy]) => <Link to={to} className="profile-menu-row" key={to}><span className="profile-menu-copy"><strong>{title}</strong><small>{copy}</small></span><ChevronRight className="row-chevron" aria-hidden="true" /></Link>)}
    </nav><div className="logout-button"><Button label="退出登录" icon={<LogOut size={16} />} variant="ghost" clickAction={logout} /></div>
    <SiteInfo />
  </div>
}

const external = { target: '_blank', rel: 'noopener noreferrer' }

function SiteInfo() {
  return <footer className="site-info">
    <p>联系邮箱：<a href="mailto:xjdaos@126.com">xjdaos@126.com</a></p>
    <p>
      <a href="https://xjdao.xyz/doc/%E4%B9%A1%E5%BB%BADAO-%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96.pdf" {...external}>隐私政策</a>
      {' • '}
      <a href="https://xjdao.xyz/doc/%E4%B9%A1%E5%BB%BADAO-%E7%94%A8%E6%88%B7%E6%9C%8D%E5%8A%A1%E5%8D%8F%E8%AE%AE.pdf" {...external}>服务条款</a>
    </p>
    <p>Powered by XJDAO</p>
    <p><a href="https://beian.miit.gov.cn/" {...external}>京ICP备2025136647号</a></p>
  </footer>
}
