import { LoginLink } from '../session/LoginLink'
import { Button } from '@astryxdesign/core/Button'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, LogOut } from 'lucide-react'

import { logoutRice } from '../session/api'
import { useStoredSession } from '../session/session'

export function SettingsPage() {
  const { session, saveSession } = useStoredSession()
  const navigate = useNavigate()

  if (!session) {
    return (
      <div className="page signed-out-state">
        <strong>登录后管理账号</strong>
        <LoginLink className="primary-link">前往登录</LoginLink>
      </div>
    )
  }

  const logout = async () => {
    await logoutRice({ data: session.token }).catch(() => undefined)
    saveSession(null)
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
