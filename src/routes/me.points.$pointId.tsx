import { createFileRoute } from '@tanstack/react-router'
import { PointWalletPage } from '~/features/points/PointWalletPage'

export const Route = createFileRoute('/me/points/$pointId')({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === 'send' || search.mode === 'receive' ? search.mode : 'history',
    to: typeof search.to === 'string' ? search.to.slice(0, 320) : '',
  }),
  component: PointWalletPage,
})
