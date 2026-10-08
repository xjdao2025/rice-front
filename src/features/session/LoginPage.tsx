import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import { useRef, useState } from 'react'

import { loginRice } from '~/features/session/api'
import { useStoredSession } from '~/features/session/session'
import { PasswordInput } from '~/components/PasswordInput'
import { loginReturnTo } from './login-redirect'
import { useAuthOptions } from './useAuthOptions'

export function LoginPage({ returnTo }: { returnTo?: string }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const identifierInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const { saveSession } = useStoredSession()
  const navigate = useNavigate()
  const currentHref = useRouterState({ select: (state) => state.location.href })
  const destination = loginReturnTo(returnTo ?? currentHref)
  const { options } = useAuthOptions()

  const submit = async () => {
    const submittedIdentifier = identifierInput.current?.value.trim() || identifier.trim()
    const submittedPassword = passwordInput.current?.value || password
    if (!submittedIdentifier || !submittedPassword) {
      setError('请输入手机号或邮箱和密码')
      return
    }
    setError('')
    try {
      const session = await loginRice({
        data: { identifier: submittedIdentifier, password: submittedPassword },
      })
      saveSession(session)
      await navigate({ href: destination, replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    }
  }

  return (
    <div className="page narrow-page account-entry-page">
      <section className="page-intro">
        <div className="eyebrow">欢迎回来</div>
        <h1>登录</h1>
        <p>登录后即可发布内容、参与节点互动。</p>
      </section>

      <section className="login-card">
        <div className="login-icon" aria-hidden="true">
          <LogIn size={30} />
        </div>
        <TextInput
          ref={identifierInput}
          label="手机号或邮箱"
          value={identifier}
          onChange={setIdentifier}
          placeholder="输入注册时验证的手机号或邮箱"
          description="请使用已验证的手机号或邮箱登录，昵称不能用于登录。"
          width="100%"
          hasAutoFocus
        />
        <PasswordInput
          ref={passwordInput}
          label="密码"
          value={password}
          onChange={setPassword}
          placeholder="输入密码"
          width="100%"
          onEnter={submit}
        />
        {error ? <div className="form-error">{error}</div> : null}
        <div className="form-actions">
          <Button
            label="登录"
            variant="primary"
            size="lg"
            clickAction={submit}
          />
        </div>
        {options?.semi_enabled ? <div className="form-actions">
          <Button label="使用 Semi 登录" variant="secondary" size="lg"
            onClick={() => { window.location.href = `/auth/semi/login?returnTo=${encodeURIComponent(destination)}` }} />
        </div> : null}
        <div className="login-links">
          <Link to="/register" search={{ returnTo: destination }}>创建账号</Link>
          <Link to="/forgot-password">忘记密码？</Link>
        </div>
      </section>
    </div>
  )
}
