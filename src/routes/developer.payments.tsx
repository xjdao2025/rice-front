import { createFileRoute } from '@tanstack/react-router'
import { PaymentAppsPage } from '~/features/points/PaymentAppsPage'

export const Route = createFileRoute('/developer/payments')({ component: PaymentAppsPage })
