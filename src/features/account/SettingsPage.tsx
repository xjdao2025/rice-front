import { SignedOutState } from '../session/LoginLink'
import { Button } from '@astryxdesign/core/Button'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, LogOut } from 'lucide-react'

import { useState } from 'react'
import { logoutStoredSession, useStoredSession } from '../session/session'

export function SettingsPage() {
  const { session } = useStoredSession()
  const [logoutWarning, setLogoutWarning] = useState('')
  const navigate = useNavigate()

  if (!session) {
    return <><SignedOutState title="登录后管理账号" />{logoutWarning && <p role="alert">{logoutWarning}</p>}</>
  }

  const logout = async () => {
    const result = await logoutStoredSession(session).catch(() => ({ riceRevoked: false, pdsRevoked: false }))
    if (!result.riceRevoked || !result.pdsRevoked) {
      setLogoutWarning('本机已退出，但部分服务端会话未能撤销，请稍后重试或重置密码。')
      return
    }
    await navigate({ to: '/login' })
  }

  return (
    <div className="page settings-page">
      <h1>设置</h1>
      <nav className="profile-menu" aria-label="设置项目">
        <Link to="/me/settings/account" className="profile-menu-row">
          <span className="profile-menu-copy"><strong>账号与安全</strong><small>手机号、邮箱、密码与注销</small></span>
          <ChevronRight className="row-chevron" aria-hidden="true" />
        </Link>
        <Link to="/me/settings/profile" className="profile-menu-row">
          <span className="profile-menu-copy"><strong>个人资料</strong><small>头像、昵称和简介</small></span>
          <ChevronRight className="row-chevron" aria-hidden="true" />
        </Link>
      </nav>
      <div className="logout-button">
        <Button label="退出登录" icon={<LogOut size={16} />} variant="ghost" clickAction={logout} />
      </div>
    </div>
  )
}
