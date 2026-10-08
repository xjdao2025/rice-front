import { createFileRoute } from '@tanstack/react-router'
import { getGrainGrants } from '~/features/alliance/api'
import { GrainGrantsPage } from '~/features/alliance/GrainGrantsPage'

export const Route = createFileRoute('/alliance/grain-grants')({
  loader: () => getGrainGrants({ data: {} }),
  component: () => <GrainGrantsPage initialPage={Route.useLoaderData()} />,
})
