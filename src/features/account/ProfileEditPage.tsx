import { LoginLink } from '../session/LoginLink'
import { Button } from '@astryxdesign/core/Button'
import { FileInput } from '@astryxdesign/core/FileInput'
import { TextArea } from '~/components/AutoTextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Avatar } from '~/components/Avatar'
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, imageSizeLabel, prepareImage, readFileBase64 } from '~/lib/images'

import { useStoredSession } from '../session/session'
import { updateCurrentUser, uploadRiceAttachment } from './api'

export function ProfileEditPage({ onSaved, avatarOnly = false }: { onSaved?: () => void | Promise<void>; avatarOnly?: boolean }) {
  const { session, saveSession } = useStoredSession()
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(session?.user.nickname || '')
  const [bio, setBio] = useState(session?.user.bio || '')
  const [avatar, setAvatar] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!avatar) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(avatar)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [avatar])

  if (!session) {
    return <LoginRequired />
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      if (avatarOnly && !avatar) {
        await onSaved?.()
        return
      }
      const prepared = avatar ? await prepareImage(avatar) : null
      const attachment = prepared
        ? await uploadRiceAttachment({
            data: {
              token: session.token,
              filename: prepared.name,
              contentType: prepared.type,
              base64: await readFileBase64(prepared),
            },
          })
        : null
      const user = await updateCurrentUser({
        data: {
          token: session.token,
          nickname: avatarOnly ? session.user.nickname || '' : nickname,
          bio: avatarOnly ? session.user.bio || '' : bio,
          avatarId: attachment?.id,
        },
      })
      saveSession({ ...session, user })
      if (onSaved) await onSaved(); else await navigate({ to: '/me' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料保存失败')
    } finally {
      setBusy(false)
    }
  }

  const avatarUrl = preview || session.user.avatar?.url

  return (
    <div className="page narrow-page profile-edit-page">
      <h1>{avatarOnly ? '设置你的头像' : '个人资料'}</h1>
      {avatarOnly ? <p>账号已创建。选择一张头像，也可以稍后在个人资料中设置。</p> : null}
      <section className="form-card">
        <Avatar name={nickname || session.user.handle} src={avatarUrl} size="large" />
        <FileInput
          label="头像"
          placeholder="选择图片"
          value={avatar}
          onChange={(file) => setAvatar(file as File | null)}
          accept={IMAGE_ACCEPT}
          description={`支持 PNG、JPEG、GIF 或 WebP，大图自动压缩到 ${imageSizeLabel(MAX_IMAGE_BYTES)} 以内（GIF 除外）。`}
          width="100%"
          isOptional
        />
        {!avatarOnly ? <>
          <TextInput
            label="昵称"
            value={nickname}
            onChange={(value) => setNickname(value.slice(0, 64))}
            width="100%"
          />
          <TextArea
            label="简介"
            value={bio}
            onChange={setBio}
            maxLength={512}
            width="100%"
          />
        </> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="form-actions">
          {avatarOnly ? <Button label="稍后设置" variant="ghost" onClick={onSaved} isDisabled={busy} /> : null}
          <Button
            label={avatarOnly ? '完成' : '保存'}
            variant="primary"
            size="lg"
            clickAction={save}
            isLoading={busy}
          />
        </div>
      </section>
    </div>
  )
}

function LoginRequired() {
  return (
    <div className="page signed-out-state">
      <strong>登录后编辑资料</strong>
      <LoginLink className="primary-link">前往登录</LoginLink>
    </div>
  )
}
