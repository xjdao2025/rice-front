import { createMemoryHistory, createRootRoute, createRoute, createRouter, type AnyRoute } from '@tanstack/react-router'
import { expect, it, vi } from 'vitest'

vi.mock('~/features/alliance/AlliancePanel', () => ({ AlliancePanel: () => null }))
import { Route } from './alliance.index'

it('restores the selected proposal filter after returning from a detail without adding a filter history step', async () => {
  const root = createRootRoute()
  const options: AnyRoute['options'] = Route.options
  const alliance = createRoute({ getParentRoute: () => root, path: '/alliance', validateSearch: options.validateSearch })
  const proposal = createRoute({ getParentRoute: () => root, path: '/alliance/proposals/$id' })
  const home = createRoute({ getParentRoute: () => root, path: '/' })
  const history = createMemoryHistory({ initialEntries: ['/alliance'] })
  const router = createRouter({ routeTree: root.addChildren([alliance, proposal, home]), history, isServer: false, origin: 'http://localhost' })
  await router.load()
  const index = history.location.state.__TSR_index

  await router.navigate({ to: '/alliance', search: { status: 'passed' }, replace: true })
  expect(history.location.state.__TSR_index).toBe(index)
  await router.navigate({ to: '/alliance/proposals/$id', params: { id: 'proposal-1' } })
  history.back()
  await router.load()
  expect(router.state.location.pathname).toBe('/alliance')
  expect(router.state.matches.at(-1)?.search).toMatchObject({ status: 'passed' })

  await router.navigate({ to: '/' })
  await router.navigate({ to: '/alliance', search: {} })
  expect(router.state.matches.at(-1)?.search).toMatchObject({ status: undefined })
})

it('ignores an unsupported proposal filter', async () => {
  const root = createRootRoute()
  const options: AnyRoute['options'] = Route.options
  const alliance = createRoute({ getParentRoute: () => root, path: '/alliance', validateSearch: options.validateSearch })
  const router = createRouter({ routeTree: root.addChildren([alliance]), history: createMemoryHistory({ initialEntries: ['/alliance?status=unknown'] }), isServer: false, origin: 'http://localhost' })
  await router.load()
  expect(router.state.matches.at(-1)?.search).toMatchObject({ status: undefined })
})
