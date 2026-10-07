import { Button } from '@astryxdesign/core/Button'
import { Carousel, type CarouselHandle } from '@astryxdesign/core/Carousel'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { RepostChange } from '~/components/PostActions'
import { PostList } from '~/components/PostList'
import { AutoLoadMore } from '~/components/AutoLoadMore'
import type { PostFeed } from '~/lib/models'

import { useStoredSession } from '../session/session'
import { getPosts, readCachedFeed, writeCachedFeed } from './api'
import { postCategory } from './tags'

const bannerSlides = [
  { label: '交流互助', title: ['遇到问题，', '一起聊聊'], description: '分享你的疑问与经验，让彼此少走一点弯路。' },
  { label: '参与协作', title: ['找到能出力的事，', '一起完成它'], description: '浏览任务、申请承接，用你的经验参与社区协作。' },
  { label: '发起活动', title: ['把一个想法，', '变成一次相聚'], description: '发起一场活动，邀请伙伴一起参与。' },
]

function PlazaBanner() {
  const carousel = useRef<CarouselHandle>(null)
  const [activeSlide, setActiveSlide] = useState(0)
  return <div className="plaza-banner">
    <Carousel className="plaza-banner-track" aria-label="乡建 DAO 导览" gap={0} hasButtons={false} hasEdgeFade={false} hasLoop hasSnap handleRef={carousel}
      onScrollCapture={(event) => {
        const scroller = event.target as HTMLDivElement
        if (scroller.clientWidth) setActiveSlide(Math.min(bannerSlides.length - 1, Math.round(Math.abs(scroller.scrollLeft) / scroller.clientWidth)))
      }}>
      {bannerSlides.map((slide) => <div className="plaza-banner-slide" key={slide.label}>
        <span>{slide.label}</span>
        <h1>{slide.title[0]}<br />{slide.title[1]}</h1>
        <p>{slide.description}</p>
      </div>)}
    </Carousel>
    <div className="plaza-banner-controls">
      <button type="button" aria-label="上一张" onClick={() => carousel.current?.scrollPrev()}><ChevronLeft aria-hidden="true" /></button>
      <div className="plaza-banner-pages">{bannerSlides.map((slide, index) => <button type="button" key={slide.label} aria-label={`查看第 ${index + 1} 张`} aria-current={activeSlide === index ? 'true' : undefined} onClick={() => carousel.current?.scrollTo(index)}><span /></button>)}</div>
      <button type="button" aria-label="下一张" onClick={() => carousel.current?.scrollNext()}><ChevronRight aria-hidden="true" /></button>
    </div>
  </div>
}


export function PlazaPage({ initialFeed }: { initialFeed: PostFeed }) {
  const { session } = useStoredSession()
  const did = session?.pds.did
  const scopedFeed = useMemo(() => readCachedFeed(did) ?? {
    ...initialFeed,
    posts: initialFeed.posts.map(({ viewer: _viewer, ...post }) => post),
  }, [did, initialFeed])
  return <PlazaFeed key={did ?? 'guest'} initialFeed={scopedFeed} />
}

function PlazaFeed({ initialFeed }: { initialFeed: PostFeed }) {
  const [feed, setFeed] = useState(initialFeed)
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const { session, isReady } = useStoredSession()
  const accessJwt = session?.pds.access_jwt
  const did = session?.pds.did
  const request = useRef(0)
  useEffect(() => {
    const refresh = () => {
      request.current++
      setLoading(false)
      const cached = readCachedFeed(did)
      if (cached) setFeed(cached)
      else setReloadKey((value) => value + 1)
    }
    window.addEventListener('posts-changed', refresh)
    return () => window.removeEventListener('posts-changed', refresh)
  }, [did])

  useEffect(() => {
    request.current++
    if (!isReady) return
    if (reloadKey === 0) {
      const cachedFeed = readCachedFeed(did)
      if (cachedFeed) {
        setLoading(false)
        setError('')
        setFeed(cachedFeed)
        return () => { request.current++ }
      }
      if (!did) {
        setLoading(false)
        setError('')
        writeCachedFeed(initialFeed)
        setFeed(initialFeed)
        return () => { request.current++ }
      }
    }

    let active = true
    const current = request.current
    setLoading(true)
    setError('')
    void getPosts({
      data: {
        accessJwt,
        did,
        category: 'post',
      },
    })
      .then((nextFeed) => {
        if (!active || current !== request.current) return
        writeCachedFeed(nextFeed, did)
        setFeed(nextFeed)
      })
      .catch((reason) => {
        if (active && current === request.current) setError(reason instanceof Error ? reason.message : '帖子暂时无法加载')
      })
      .finally(() => {
        if (active && current === request.current) setLoading(false)
      })
    return () => { active = false; request.current++ }
  }, [accessJwt, did, initialFeed, isReady, reloadKey])

  const more = async () => {
    if (!feed.cursor || isLoading) return
    const current = request.current
    setLoading(true)
    setError('')
    try {
      const page = await getPosts({ data: { accessJwt, did, category: 'post', cursor: feed.cursor } })
      if (current !== request.current) return
      const next = { ...page, posts: [...new Map([...feed.posts, ...page.posts].map((post) => [post.reason?.uri ?? post.uri, post])).values()] }
      setFeed(next)
      writeCachedFeed(next, did)
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : '帖子暂时无法加载')
    } finally { if (current === request.current) setLoading(false) }
  }

  const handleRepostChange = ({ post, reason }: RepostChange) => {
    if (!did) return
    setFeed((current) => {
      const { reason: _previousReason, ...basePost } = post
      const viewer = { ...basePost.viewer, repost: reason?.uri }
      const remaining = current.posts
        .filter(
          (item) =>
            !(item.uri === post.uri && item.reason?.by.did === did),
        )
        .map((item) =>
          item.uri === post.uri ? { ...item, viewer } : item,
        )
      const posts = reason
        ? [{ ...basePost, viewer, reason }, ...remaining]
        : remaining
      return { ...current, posts }
    })
  }

  const handlePostDeleted = (postUri: string) => {
    setFeed((current) => ({
      ...current,
      posts: current.posts.filter((post) => post.uri !== postUri),
    }))
  }

  return (
    <div className="page plaza-page">
      <PlazaBanner />
      {error ? (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          {!feed.cursor && <Button label="重试" variant="ghost" size="sm" onClick={() => setReloadKey((value) => value + 1)} />}
        </div>
      ) : null}

      <section className="feed-section">
        <PostList
          posts={feed.posts.filter((post) => postCategory(post.record) === 'post')}
          onRepostChange={handleRepostChange}
          onPostDeleted={handlePostDeleted}
        />
        {feed.cursor && <AutoLoadMore key={did ?? 'guest'} cursor={feed.cursor} loading={isLoading || !isReady} failed={!!error} onLoadMore={more} />}
      </section>

    </div>
  )
}
