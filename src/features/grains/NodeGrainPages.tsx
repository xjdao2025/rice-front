import { Button } from '@astryxdesign/core/Button'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import QRCode from 'react-qr-code'
import { Avatar } from '~/components/Avatar'
import { LoadingState } from '~/components/LoadingState'
import { errorMessage } from '~/lib/util'
import { useStoredSession } from '../session/session'
import { LoginLink } from '../session/LoginLink'
import { getNode, type CommunityNode } from '../nodes/api'
import { CommunityFunding } from './GrainHistoryPage'

export function nodeFundLink(origin: string, nodeId: string) {
  return `${origin}/nodes/${encodeURIComponent(nodeId)}/fund`
}

function useNode(nodeId: string, token?: string) {
  const [node, setNode] = useState<CommunityNode | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void getNode({ data: { id: nodeId, token } }).then((value) => { if (active) setNode(value) }).catch((reason) => { if (active) setError(errorMessage(reason, '节点暂时无法加载')) })
    return () => { active = false }
  }, [nodeId, token])
  return { node, error }
}

function NodeCard({ node }: { node: CommunityNode }) {
  return <><Avatar name={node.name} src={node.logo?.url} /><strong>{node.name}</strong></>
}

/** 节点的收稻米码:谁扫了都能把自己的稻米转入这个节点 */
export function NodeReceiveGrainPage({ nodeId }: { nodeId: string }) {
  const { session } = useStoredSession()
  const { node, error } = useNode(nodeId, session?.token)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  if (error) return <div className="page"><p className="inline-error" role="alert">{error}</p></div>
  if (!node) return <LoadingState label="正在加载节点…" className="page loading-line" />
  const link = nodeFundLink(typeof window === 'undefined' ? '' : window.location.origin, nodeId)
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setCopyError('') }
    catch { setCopyError('未能复制，请手动复制下方链接。') }
  }
  return <div className="page business-panel form-stack">
    <div className="grain-receive-card">
      <div className="grain-receive-qr"><QRCode value={link} size={180} title="节点收稻米码" /></div>
      <NodeCard node={node} />
    </div>
    <p>请对方扫码或打开链接，把稻米转入这个节点。</p>
    <a href={link} style={{ overflowWrap: 'anywhere' }}>{link}</a>
    {copyError && <p className="inline-error" role="alert">{copyError}</p>}
    <div className="form-actions"><Button label={copied ? '已复制' : '复制接收链接'} variant="primary" clickAction={copy} /></div>
  </div>
}

/** 扫节点收稻米码打开的页面:把自己的稻米转入节点 */
export function NodeFundPage({ nodeId }: { nodeId: string }) {
  const { session } = useStoredSession()
  const { node, error } = useNode(nodeId, session?.token)
  const [funded, setFunded] = useState<number | null>(null)
  if (!session) return <div className="page"><LoginLink className="primary-link">登录后向节点转入稻米</LoginLink></div>
  if (error) return <div className="page"><p className="inline-error" role="alert">{error}</p></div>
  if (!node) return <LoadingState label="正在加载节点…" className="page loading-line" />
  return <div className="page business-panel form-stack">
    <div className="grain-receive-card"><NodeCard node={node} /></div>
    {funded === null
      ? <CommunityFunding nodeId={nodeId} token={session.token} startOpen onFunded={setFunded} />
      : <><strong role="status">已向「{node.name}」转入 {funded} 稻米</strong><Link to="/me/grains">查看我的稻米记录</Link></>}
  </div>
}
