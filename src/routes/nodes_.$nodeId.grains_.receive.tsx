import { createFileRoute } from '@tanstack/react-router'
import { NodeReceiveGrainPage } from '~/features/grains/NodeGrainPages'

export const Route = createFileRoute('/nodes_/$nodeId/grains_/receive')({
  component: () => <NodeReceiveGrainPage nodeId={Route.useParams().nodeId} />,
})
