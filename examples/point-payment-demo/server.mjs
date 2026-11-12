import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const base = new URL(process.env.RICE_URL || 'https://xjdao.net')
const credential = process.env.RICE_PAYMENT_KEY
if (!credential) throw new Error('Set RICE_PAYMENT_KEY to the registered app credential')
const prefix = process.env.DEMO_PATH || ''
if (prefix && !/^\/[a-z0-9-]+$/.test(prefix)) throw new Error('Invalid DEMO_PATH')
const orders = new Map()
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])

async function rice(path, body) {
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Rice 返回 HTTP ' + response.status)
  return (await response.json()).data
}

function page(res, status, content) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
  })
  res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>积分商店 Demo</title><main><h1>积分商店 Demo</h1>' + content + '</main></html>')
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/') {
      const draft = randomUUID()
      orders.set(draft, { draft })
      return page(res, 200, '<p>社区活动纪念卡 · 10 积分</p><form method="post" action="' + prefix + '/buy/' + draft + '"><button>前往 Rice 付款</button></form>')
    }

    if (req.method === 'POST' && url.pathname.startsWith('/buy/')) {
      const draft = url.pathname.slice(5)
      const local = orders.get(draft)
      if (!local) return page(res, 404, '<p>订单不存在。</p>')
      const order = await rice('/v1/payment-intents', { external_order_id: draft, amount: '10' })
      const checkout = new URL(order.checkout_url)
      if (checkout.origin !== base.origin || !checkout.pathname.startsWith('/point-checkout/')) {
        throw new Error('结账链接不在配置的 Rice 站点')
      }
      orders.set(order.id, local)
      res.writeHead(303, { location: checkout.href, 'cache-control': 'no-store' })
      return res.end()
    }

    if (req.method === 'GET' && url.pathname === '/return') {
      const id = url.searchParams.get('rice_order_id')
      const local = orders.get(id)
      if (!local) return page(res, 404, '<p>订单不存在。重启 Demo 会清空本地订单。</p>')
      const order = await rice('/v1/payment-intents/' + encodeURIComponent(id))
      if (order.id !== id || order.external_order_id !== local.draft || order.amount !== '10') {
        throw new Error('订单信息与商店记录不符')
      }
      if (order.status === 'succeeded' && order.transaction_id) {
        local.fulfilled ??= order.transaction_id
        return page(res, 200, '<p>已付款，纪念卡已发放。</p><p>交易编号：<code>' + escape(local.fulfilled) + '</code></p><a href="' + prefix + '/">返回商店</a>')
      }
      return page(res, 200, '<p>订单状态：' + escape(order.status) + '。确认到账后才会发放。</p><a href="">刷新查单</a>')
    }

    return page(res, 404, '<p>页面不存在。</p>')
  } catch (error) {
    return page(res, 502, '<p>' + escape(error.message) + '</p><p>如遇超时，请返回上一页重试或刷新查单。</p>')
  }
}).listen(Number(process.env.PORT || 19500), process.env.DEMO_BIND || '127.0.0.1')
