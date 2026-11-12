import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { backendData } from '~/lib/http'
import { credential, id, object, text } from '~/lib/validation'

export type PaymentApp = {
  id: string
  name: string
  point_id: string
  payee_account_id: string
  return_url: string
  active: boolean
  credential_stored: boolean
}

export const listPaymentApps = createServerFn({ method: 'POST' })
  .validator(object({ token: credential }))
  .handler(({ data }) => backendData<PaymentApp[]>('/api/payment-apps', { token: data.token }))

export const registerPaymentApp = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, pointId: id, name: text(255, 1), returnUrl: text(2048, 1) }))
  .handler(({ data }) => backendData<PaymentApp>('/api/payment-apps', {
    token: data.token, method: 'POST',
    json: { point_id: data.pointId, name: data.name, return_url: data.returnUrl },
  }))

export const revealPaymentCredential = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, appId: id }))
  .handler(({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    return backendData<{ credential: string }>(`/api/payment-apps/${encodeURIComponent(data.appId)}/credential`, {
      token: data.token, method: 'POST', cache: 'no-store',
    })
  })

export const rotatePaymentCredential = createServerFn({ method: 'POST' })
  .validator(object({ token: credential, appId: id }))
  .handler(({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    return backendData<{ credential: string }>(`/api/payment-apps/${encodeURIComponent(data.appId)}/rotate-credential`, {
      token: data.token, method: 'POST', cache: 'no-store',
    })
  })
