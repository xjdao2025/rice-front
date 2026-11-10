import { createServerFn } from '@tanstack/react-start'
import { backendData } from '~/lib/http'
import { credential, object, text } from '~/lib/validation'

type CheckoutResult = { id: string; status: string; return_url: string }
export type CheckoutDetails = CheckoutResult & {
  app_name: string
  payee_name: string
  point_code: string
  point_name?: string
  amount: string
}

const input = object({ token: credential, checkoutToken: text(1024, 1) })
const path = (token: string) => '/api/point-checkout/' + encodeURIComponent(token)

export const getPointCheckout = createServerFn({ method: 'POST' })
  .validator(input)
  .handler(({ data }) => backendData<CheckoutDetails>(path(data.checkoutToken), { token: data.token }))

export const confirmPointCheckout = createServerFn({ method: 'POST' })
  .validator(input)
  .handler(({ data }) => backendData<CheckoutResult>(path(data.checkoutToken), { method: 'POST', token: data.token }))
