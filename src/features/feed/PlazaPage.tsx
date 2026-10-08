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
import { bannerHref, type Banner } from './banners'
import { postCategory } from './tags'

const BANNER_ROTATION_MS = 6_000

function PlazaBanner({ banners }: { banners: Banner[] }) {
  const carousel = useRef<CarouselHandle>(null)
  const [activeSlide, setActiveSlide] = useState(0)
  const slides = banners.filter((banner) => banner.image?.url)
  useEffect(() => {
    if (slides.length < 2) return
    const timer = window.setInterval(() => {
      if (!document.hidden) carousel.current?.scrollNext()
    }, BANNER_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [slides.length])
  if (!slides.length) return null

  return <div className="plaza-banner">
    <Carousel className="plaza-banner-track" aria-label="公告与推荐" gap={0} hasButtons={false} hasEdgeFade={false} hasLoop hasSnap handleRef={carousel}
      onScrollCapture={(event) => {
        const scroller = event.target as HTMLDivElement
        if (scroller.clientWidth) setActiveSlide(Math.min(slides.length - 1, Math.round(Math.abs(scroller.scrollLeft) / scroller.clientWidth)))
      }}>
      {slides.map((banner, index) => {
        const image = <img src={banner.image!.url} alt={`轮播图 ${index + 1}`} loading={index === 0 ? 'eager' : 'lazy'} />
        const href = bannerHref(banner.url)
        return <div className="plaza-banner-slide" key={banner.id}>
          {href ? <a href={href} target={/^https?:\/\//i.test(href) ? '_blank' : undefined} rel="noopener noreferrer" aria-label={`打开第 ${index + 1} 张轮播图的链接`}>{image}</a> : image}
        </div>
      })}
    </Carousel>
    {slides.length > 1 && <div className="plaza-banner-controls">
      <button type="button" aria-label="上一张" onClick={() => carousel.current?.scrollPrev()}><ChevronLeft aria-hidden="true" /></button>
      <div className="plaza-banner-pages">{slides.map((banner, index) => <button type="button" key={banner.id} aria-label={`查看第 ${index + 1} 张`} aria-current={activeSlide === index ? 'true' : undefined} onClick={() => carousel.current?.scrollTo(index)}><span /></button>)}</div>
      <button type="button" aria-label="下一张" onClick={() => carousel.current?.scrollNext()}><ChevronRight aria-hidden="true" /></button>
    </div>}
  </div>
}


export function PlazaPage({ initialFeed, banners }: { initialFeed: PostFeed; banners: Banner[] }) {
  const { session } = useStoredSession()
  const did = session?.pds.did
  const scopedFeed = useMemo(() => readCachedFeed(did) ?? {
    ...initialFeed,
    posts: initialFeed.posts.map(({ viewer: _viewer, ...post }) => post),
  }, [did, initialFeed])
  return <PlazaFeed key={did ?? 'guest'} initialFeed={scopedFeed} banners={banners} />
}

function PlazaFeed({ initialFeed, banners }: { initialFeed: PostFeed; banners: Banner[] }) {
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
      <PlazaBanner banners={banners} />
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
