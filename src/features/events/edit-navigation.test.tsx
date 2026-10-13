import { createMemoryHistory, type AnyRouter, type AnyRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'
import type { RiceEvent } from './api'

const state = vi.hoisted(() => ({
  session: { token: 'token', user: { id: 'organizer' }, pds: { did: 'did:example:organizer' } } as RiceSession,
  router: null as AnyRouter | null,
  onPublished: null as ((id: string) => Promise<void>) | null,
}))
const api = vi.hoisted(() => ({ event: vi.fn() }))
vi.mock('@tanstack/react-router', async original => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  useNavigate: () => state.router!.navigate,
  useRouter: () => state.router!,
  useBlocker: () => undefined,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}))
vi.mock('../session/session', () => ({
  readStoredSession: () => state.session,
  useStoredSession: () => ({ session: state.session, isReady: true }),
}))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getEvent: api.event }))
vi.mock('./EventCreateForm', () => ({ EventCreateForm: ({ onPublished }: { onPublished: (id: string) => Promise<void> }) => {
  state.onPublished = onPublished
  return null
} }))
vi.mock('~/routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router')
  const { Route } = await import('~/routes/events_.$eventId')
  const options: AnyRoute['options'] = Route.options
  const root = createRootRoute()
  const home = createRoute({ getParentRoute: () => root, path: '/' })
  const compose = createRoute({ getParentRoute: () => root, path: '/compose' })
  const detail = createRoute({ getParentRoute: () => root, path: '/events/$eventId', loader: options.loader, loaderDeps: options.loaderDeps, ssr: options.ssr })
    .update({ id: '/events_/$eventId' } as never)
  return { routeTree: root.addChildren([home, compose, detail]) }
})

import { getRouter } from '~/router'
import { ComposePanel, type ComposeInitialData } from '../feed/ComposePanel'
import { EventDetail } from './EventDetail'

it('returns from editing only after fresh detail data replaces the old cached event', async () => {
  const oldEvent = {
    id: 'event-1', title: '旧活动标题', description: '旧活动介绍', location: '旧地点',
    status: 'open', node: { id: 'node', name: '社区', logo: null },
    creator: { id: 'organizer', handle: 'organizer' }, fee_amount: 0, capacity: 10,
    application_deadline: '2099-10-10T00:00:00Z', starts_at: '2099-10-11T00:00:00Z', ends_at: '2099-10-11T12:00:00Z',
    application_count: 0, approved_count: 0, my_application: null,
    allowed_actions: ['edit'], applications: [], history: [], attachments: [],
  } as unknown as RiceEvent
  const otherEvent = { ...oldEvent, id: 'event-2', title: '其它活动' }
  api.event.mockImplementation(({ data }: { data: { id: string } }) => Promise.resolve(data.id === oldEvent.id ? oldEvent : otherEvent))
  const router = getRouter()
  state.router = router
  router.update({ history: createMemoryHistory({ initialEntries: ['/'] }), isServer: false, origin: 'http://localhost', scrollRestoration: false })
  await router.load()
  await router.navigate({ to: '/events/$eventId', params: { eventId: oldEvent.id } })
  expect(router.state.matches.at(-1)?.loaderData).toMatchObject({ event: { title: oldEvent.title } })
  await router.navigate({ to: '/events/$eventId', params: { eventId: otherEvent.id } })
  await router.navigate({ to: '/compose', search: { kind: 'activity', editId: oldEvent.id } })
  expect(router.matchRoutes('/events/event-1', {}).at(-1)?.loaderData).toMatchObject({ event: { title: oldEvent.title } })
  expect(router.matchRoutes('/events/event-2', {}).at(-1)?.loaderData).toMatchObject({ event: { title: otherEvent.title } })

  const initialData = {
    token: 'token', kind: 'activity', editId: oldEvent.id, managedNodes: [oldEvent.node], nodesError: '',
    postDraft: null, postDraftError: '', taskDraft: null, taskDraftError: '', eventDraft: oldEvent, eventDraftError: '',
  } as unknown as ComposeInitialData
  renderToStaticMarkup(<ComposePanel initialKind="activity" editId={oldEvent.id} initialData={initialData} />)
  let finishDetail!: (event: RiceEvent) => void
  api.event.mockImplementationOnce(() => new Promise(resolve => { finishDetail = resolve }))
  const publication = state.onPublished!(oldEvent.id)
  await vi.waitFor(() => expect(api.event).toHaveBeenCalledTimes(3))
  expect(router.state.resolvedLocation?.pathname).toBe('/compose')
  expect(router.matchRoutes('/events/event-2', {}).at(-1)?.loaderData).toMatchObject({ event: { title: otherEvent.title } })

  const savedEvent = { ...oldEvent, title: '更新后的活动标题', description: '更新后的活动介绍', location: '更新后的地点' }
  finishDetail(savedEvent)
  await publication
  expect(router.state.resolvedLocation?.pathname).toBe('/events/event-1')
  const initial = router.state.matches.at(-1)!.loaderData as { event: RiceEvent; error: string; viewerToken: string }
  expect(initial.event).toEqual(savedEvent)
  const html = renderToStaticMarkup(<EventDetail eventId={oldEvent.id} initial={initial} />)
  expect(html).toContain(savedEvent.title)
  expect(html).toContain(savedEvent.description)
  expect(html).toContain(savedEvent.location)
  expect(html).not.toContain(oldEvent.title)
  expect(html).toContain('event-edit-link')
})
