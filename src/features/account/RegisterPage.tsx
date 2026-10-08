import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useNavigate } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'

import { useStoredSession } from '../session/session'
import { loginReturnTo } from '../session/login-redirect'
import { useAuthOptions } from '../session/useAuthOptions'
import {
  registerRice,
  registrationUsernameError,
  verifyRegistration,
  type VerificationChannel,
} from './api'
import { VerificationFields } from './VerificationFields'
import { ProfileEditPage } from './ProfileEditPage'
import { PasswordInput } from '~/components/PasswordInput'

export function RegisterPage({ returnTo }: { returnTo?: string }) {
  const [channel, setChannel] = useState<VerificationChannel>('sms')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [username, setUsername] = useState('')
  const [step, setStep] = useState<'credentials' | 'username'>('credentials')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const { session, saveSession } = useStoredSession()
  const navigate = useNavigate()
  const { options, error: optionsError } = useAuthOptions()
  const channels = options?.registration_channels ?? []
  const selectedChannel = channels.includes(channel) ? channel : channels[0] ?? channel

  const verify = async () => {
    if (busy || password.length < 8) return
    setBusy(true)
    setError('')
    try {
      const result = await verifyRegistration({
        data: {
          channel: selectedChannel,
          code,
          ...(selectedChannel === 'sms' ? { phone: contact, phoneRegion: '86' } : { email: contact }),
        },
      })
      setTicket(result.ticket)
      setStep('username')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码校验失败')
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    if (busy || !options?.handle_domain || registrationUsernameError(username)) return
    setBusy(true)
    setError('')
    try {
      const session = await registerRice({ data: { ticket, username, password } })
      saveSession(session)
      setPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '注册失败')
    } finally {
      setBusy(false)
    }
  }

  const finish = () => navigate({ href: loginReturnTo(returnTo), replace: true })
  if (session) return <ProfileEditPage avatarOnly onSaved={finish} />

  return (
    <div className="page narrow-page account-entry-page">
      <section className="page-intro">
        <div className="eyebrow">一个身份，走遍全联盟</div>
        <h1>{step === 'username' ? '设置你的用户名' : '创建账号'}</h1>
        <p>{step === 'username' ? '选择一个用户名，方便大家找到你。' : '验证手机号或邮箱，设置密码即可加入。'}</p>
      </section>
      <section className="form-card">
        <div className="login-icon"><UserPlus size={28} /></div>
        {optionsError ? <p className="form-error" role="alert">{optionsError}</p> : null}
        {options && !channels.length ? <p>注册暂未开放，请稍后再试。</p> : null}
        {options?.verification_mode === 'log' ? <p className="form-notice">测试模式：验证码仅写入服务器日志，不会发送短信或邮件。</p> : null}
        {channels.length ? <>
        {step === 'credentials' ? (
          <>
            <VerificationFields
              channel={selectedChannel}
              setChannel={(value) => { if (value === selectedChannel) return; setChannel(value); setContact(''); setCode(''); setError(''); setNotice('') }}
              contact={contact}
              setContact={setContact}
              code={code}
              setCode={setCode}
              purpose="register"
              channels={channels}
              disabled={busy}
              onError={setError}
              onSent={() => setNotice(options?.verification_mode === 'log' ? '测试验证码已写入服务器日志。' : `验证码已发送，请检查${selectedChannel === 'email' ? '邮箱' : '短信'}。`)}
            />
            <PasswordInput
              label="密码"
              value={password}
              onChange={setPassword}
              description="至少 8 位。"
              width="100%"
              isDisabled={busy}
              isRequired
            />
            {notice ? <div className="form-notice">{notice}</div> : null}
            <div className="form-actions">
              <Button
                label="下一步"
                variant="primary"
                size="lg"
                clickAction={verify}
                isLoading={busy}
                isDisabled={busy || !contact.trim() || !code.trim() || password.length < 8}
              />
            </div>
          </>
        ) : (
          <>
            <TextInput
              label="用户名"
              value={username}
              onChange={setUsername}
              placeholder="你的用户名"
              description="仅限字母、数字和连字符，3–18 个字符；不能以连字符开头或结尾。"
              width="100%"
              isDisabled={busy}
              isRequired
            />
            {options?.handle_domain ? <p className="form-notice" aria-live="polite">
              @{username.trim().toLowerCase() || '用户名'}.{options.handle_domain}
            </p> : <p className="form-error" role="alert">用户名配置暂时无法获取，请刷新后重试。</p>}
            <div className="form-actions">
              <Button label="返回修改联系方式" variant="ghost" isDisabled={busy} onClick={() => {
                setTicket(''); setStep('credentials'); setError('')
              }} />
              <Button
                label="下一步"
                variant="primary"
                size="lg"
                clickAction={register}
                isLoading={busy}
                isDisabled={busy || !options?.handle_domain || !!registrationUsernameError(username)}
              />
            </div>
          </>
        )}
        </> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </section>
    </div>
  )
}
