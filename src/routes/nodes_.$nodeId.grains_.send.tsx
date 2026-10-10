import { createFileRoute } from '@tanstack/react-router'
import { SendGrainPage } from '~/features/grains/PersonalGrainActions'

export const Route = createFileRoute('/nodes_/$nodeId/grains_/send')({
  component: () => <SendGrainPage nodeId={Route.useParams().nodeId} />,
})
