import { Button } from '@astryxdesign/core/Button'
import { useNavigate } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'

import { resetRicePassword, type VerificationChannel } from './api'
import { VerificationFields } from './VerificationFields'
import { PasswordInput } from '~/components/PasswordInput'

export function ForgotPasswordPage() {
  const [channel, setChannel] = useState<VerificationChannel>('sms')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await resetRicePassword({
        data: {
          channel,
          code,
          password,
          ...(channel === 'sms' ? { phone: contact, phoneRegion: '86' } : { email: contact }),
        },
      })
      await navigate({ to: '/login' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '密码重置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow-page account-entry-page">
      <section className="page-intro">
        <div className="eyebrow">验证已登记的联系方式</div>
        <h1>找回密码</h1>
        <p>重置后，当前账号的所有 Rice 登录令牌都会失效。</p>
      </section>
      <section className="form-card">
        <div className="login-icon"><KeyRound size={28} /></div>
        <VerificationFields
          channel={channel}
          setChannel={setChannel}
          contact={contact}
          setContact={setContact}
          code={code}
          setCode={setCode}
          purpose="reset_password"
          disabled={busy}
          onError={setError}
          onSent={() => setNotice('验证码已发送，请检查短信或邮箱。')}
        />
        <PasswordInput
          label="新密码"
          value={password}
          onChange={setPassword}
          description="至少 8 位"
          width="100%"
          isDisabled={busy}
        />
        {notice ? <div className="form-notice">{notice}</div> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="form-actions">
          <Button
            label="重置密码"
            variant="primary"
            size="lg"
            clickAction={submit}
            isLoading={busy}
            isDisabled={!contact.trim() || !code.trim() || password.length < 8}
          />
        </div>
      </section>
    </div>
  )
}
