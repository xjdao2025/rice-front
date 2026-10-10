import { createFileRoute } from '@tanstack/react-router'
import { NodeFundPage } from '~/features/grains/NodeGrainPages'

export const Route = createFileRoute('/nodes_/$nodeId/fund')({
  component: () => <NodeFundPage nodeId={Route.useParams().nodeId} />,
})
