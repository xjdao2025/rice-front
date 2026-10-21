import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { authorDisplayName } from '~/lib/format'
import { Avatar } from '~/components/Avatar'
import { LoadingState } from '~/components/LoadingState'
import type { SocialProfile } from '~/lib/models'

import { useStoredSession } from '../session/session'
import { getSocialProfile, toggleFollow } from './api'
import { PublicProfileContent } from './PublicProfileContent'
import { PersonalGrainActions } from '../grains/PersonalGrainActions'
import { errorMessage } from '~/lib/util'

type UserProfileProps = { actor: string; initialSend?: boolean }

export function UserProfilePage(props: UserProfileProps) {
  const { session } = useStoredSession()
  return <UserProfileContent key={`${props.actor}:${session?.user.id ?? 'guest'}`} {...props} />
}

function UserProfileContent({ actor, initialSend = false }: UserProfileProps) {
  const { session } = useStoredSession()
  const navigate = useNavigate()
  const returnTo = useRouterState({ select: (state) => state.location.href })
  const [profile, setProfile] = useState<SocialProfile | null>(null)
  const [error, setError] = useState('')
  const [followError, setFollowError] = useState('')
  const [isFollowing, setFollowing] = useState(false)

  useEffect(() => {
    let active = true
    setError('')
    void getSocialProfile({
      data: { actor, accessJwt: session?.pds.access_jwt },
    })
      .then((nextProfile) => { if (active) setProfile(nextProfile) })
      .catch((reason) => {
        if (active) setError(errorMessage(reason, '用户主页暂时无法显示'))
      })
    return () => { active = false }
  }, [actor, session?.pds.access_jwt])

  useEffect(() => {
    if (initialSend && profile) void navigate({ to: '/me/grains/send', search: { to: profile.did }, replace: true })
  }, [initialSend, profile, navigate])

  const ownProfile = Boolean(profile && session?.pds.did === profile.did)

  const changeFollow = async () => {
    if (!profile) return
    if (!session) {
      await navigate({ to: '/login', search: { returnTo } })
      return
    }

    const previousUri = profile.viewer?.following
    setFollowing(true)
    setFollowError('')
    try {
      const { recordUri } = await toggleFollow({
        data: {
          did: session.pds.did,
          accessJwt: session.pds.access_jwt,
          targetDid: profile.did,
          ...(previousUri ? { recordUri: previousUri } : {}),
        },
      })
      setProfile((current) => current ? {
        ...current,
        followersCount: Math.max(0, current.followersCount + (recordUri ? 1 : -1)),
        viewer: { ...current.viewer, following: recordUri ?? undefined },
      } : current)
    } catch (reason) {
      setFollowError(errorMessage(reason, '关注状态更新失败'))
    } finally {
      setFollowing(false)
    }
  }

  return (
    <div className="page social-profile-page">
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {profile ? (
        <>
          <section className="social-profile-card">
            {ownProfile ? (
              <Link to="/me/settings/profile" className="profile-edit-link" aria-label="编辑资料" title="编辑资料">
                <Pencil size={20} aria-hidden="true" />
              </Link>
            ) : null}
            <Avatar name={authorDisplayName(profile)} src={profile.avatar} size="large" />
            <h1>{authorDisplayName(profile)}</h1>
            <p className="social-profile-handle">@{profile.handle}</p>
            <p className="social-profile-did">{profile.did}</p>
            {profile.walletAddress ? (
              <p className="social-profile-wallet">Semi ID {profile.walletAddress}</p>
            ) : null}
            {profile.description ? (
              <p className="social-profile-description">{profile.description}</p>
            ) : null}
            {profile.viewer?.followedBy && !ownProfile ? (
              <span className="follows-you">也关注了你</span>
            ) : null}

            {session && !ownProfile && profile.socialAvailable !== false ? (
              <div className="social-profile-actions">
                <Button
                  label={profile.viewer?.following ? '已关注' : '关注'}
                  variant={profile.viewer?.following ? 'secondary' : 'primary'}
                  clickAction={changeFollow}
                  isLoading={isFollowing}
                  width="100%"
                />
              </div>
            ) : null}
            {followError ? <div className="social-follow-error" role="alert">{followError}</div> : null}
            <PersonalGrainActions key={profile.did} to={profile.did} />
          </section>

          {profile.socialAvailable !== false && <nav className="social-counts" aria-label="关注关系">
            <Link to="/profile/$actor/following" params={{ actor: profile.did }}>
              <strong>{profile.followsCount}</strong>
              <span>关注</span>
            </Link>
            <Link to="/profile/$actor/followers" params={{ actor: profile.did }}>
              <strong>{profile.followersCount}</strong>
              <span>粉丝</span>
            </Link>
          </nav>}

          <PublicProfileContent actor={profile.did} />
        </>
      ) : !error ? (
        <LoadingState label="正在加载用户主页…" className="social-loading" />
      ) : (
        <div className="empty-panel">
          <EmptyState title="无法显示这个用户" description="请稍后重试或返回广场。" />
        </div>
      )}
    </div>
  )
}
