import { createServerFn } from '@tanstack/react-start'

import { BACKEND_BASE, requestJson } from '~/lib/http'
import type { RiceAttachment } from '~/lib/models'

export type Banner = {
  id: string
  url: string
  position: number
  image: RiceAttachment | null
}

export function bannerHref(value: string) {
  const url = value.trim()
  if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) return url
  if (/^\/\/[^/]/.test(url)) return `https:${url}`
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(url)) return `https://${url}`
  return ''
}

export const getBanners = createServerFn({ method: 'GET' }).handler(async () =>
  (await requestJson<{ data: Banner[] }>(`${BACKEND_BASE}/api/banners`)).data,
)
