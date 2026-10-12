import { createFileRoute } from '@tanstack/react-router'
import { AlliancePanel } from '~/features/alliance/AlliancePanel'
import type { ProposalStatus } from '~/features/alliance/api'

export const Route = createFileRoute('/alliance/')({
  validateSearch: (search: Record<string, unknown>): { status?: ProposalStatus } => ({
    status: search.status === 'open' || search.status === 'passed' || search.status === 'rejected' ? search.status : undefined,
  }),
  component: AlliancePage,
})

function AlliancePage() {
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <AlliancePanel proposalStatus={status} onProposalStatusChange={(status) => void navigate({ search: { status }, replace: true })} />
}
