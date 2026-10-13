import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { RiceSession } from '~/lib/models'

const sessionState = vi.hoisted(() => ({ user: {} as Record<string, unknown> }))

vi.mock('@tanstack/react-router', async original => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  useNavigate: () => async () => undefined,
  useRouter: () => ({ clearCache: () => undefined }),
  useBlocker: () => undefined,
}))
vi.mock('../session/session', () => ({ useStoredSession: () => ({ session: { token: 'token', user: sessionState.user as unknown as RiceSession['user'], pds: { did: 'did:example:account' } } as RiceSession, isReady: true }) }))

import { ComposePanel, type ComposeInitialData } from './ComposePanel'

it.each([['task', 'taskDraft', '任务'], ['activity', 'eventDraft', '活动']] as const)('blocks direct edits of completed %s records', (kind, draftKey, label) => {
  const initialData = {
    token: 'token', kind, editId: 'done', managedNodes: [{ id: 'node', name: '社区' }],
    nodesError: '', postDraft: null, postDraftError: '', taskDraft: null, taskDraftError: '', eventDraft: null, eventDraftError: '',
    [draftKey]: { id: 'done', status: 'completed', allowed_actions: ['edit'] },
  } as unknown as ComposeInitialData
  const html = renderToStaticMarkup(<ComposePanel initialKind={kind} editId="done" initialData={initialData} />)
  expect(html).toContain(`此${label}目前不能编辑。`)
})

// 发活动永远要节点,所以没有可管节点的人只会看到发帖 + 发任务两个入口
it('发任务入口只给节点管理员、平台授权的人和后台超管', () => {
  const initialData = {
    token: 'token', kind: 'post', managedNodes: [], nodesError: '',
    postDraft: null, postDraftError: null, taskDraft: null, taskDraftError: null, eventDraft: null, eventDraftError: null,
  } as unknown as ComposeInitialData
  const render = () => renderToStaticMarkup(<ComposePanel initialData={initialData} />)

  sessionState.user = { id: 'account' }
  expect(render()).not.toContain('发任务')

  sessionState.user = { id: 'account', can_publish_tasks: true }
  expect(render()).toContain('发任务')

  sessionState.user = { id: 'account', superuser: true }
  expect(render()).toContain('发任务')
})
