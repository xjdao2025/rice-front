import { Button } from '@astryxdesign/core/Button'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { formatTimestamp } from '~/lib/format'
import { getGrainGrants, type GrainGrantPage } from './api'

export function GrainGrantsPage({ initialPage }: { initialPage: GrainGrantPage }) {
  const [page, setPage] = useState(initialPage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const more = async () => {
    if (loading || !page.meta.next_cursor) return
    setLoading(true)
    setError('')
    try {
      const next = await getGrainGrants({ data: { before: page.meta.next_cursor } })
      setPage((current) => ({ data: [...current.data, ...next.data], meta: next.meta }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发放记录加载失败')
    } finally {
      setLoading(false)
    }
  }

  return <div className="page grain-history-page"><h1>稻米发放记录</h1><p>累计发行 {page.meta.total_granted.toLocaleString('zh-CN')} 稻米</p>
    <section className="grain-transfer-list">{page.data.map((entry) => <details className="grain-transfer-row" key={entry.id}>
      <summary><span className="grain-transfer-copy"><strong>{entry.to_node?.name || entry.to?.nickname || entry.to?.handle || '已删除账户'}</strong>
        <time>{formatTimestamp(entry.inserted_at)}</time>{entry.memo && <span className="grain-transfer-memo">附言：{entry.memo}</span>}</span>
        <b className="incoming">+{entry.amount.toLocaleString('zh-CN')}</b><ChevronDown className="grain-transfer-chevron" size={18} aria-hidden="true" />
      </summary><div className="grain-transfer-details"><span>发放凭证编号：{entry.id}</span></div>
    </details>)}</section>
    {!page.data.length && <p className="search-hint">暂无发放记录。</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {page.meta.next_cursor && <Button label="加载更多" variant="secondary" isDisabled={loading} isLoading={loading} clickAction={more} />}
  </div>
}
