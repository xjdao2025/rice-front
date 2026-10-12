import { useEffect, useRef, useState } from 'react'
import { ContactField } from '~/components/ContactField'
import { ImageGroup, ImagePicker } from '~/components/ContentImages'
import { PublishTextArea, PublishTextInput } from '~/components/PublishFields'
import { PublishSchedule } from '~/components/PublishSchedule'
import { LoadingState } from '~/components/LoadingState'
import { PublishSteps } from '~/components/PublishSteps'
import { useRiceImages } from '../media/useRiceImages'
import { addMinutes, beijingDateTimeValue, beijingTime, beijingTimeIso, nextTimeSlot, roundedTimeValue } from '~/lib/date-time'
import { useFormCloseState, type FormCloseState } from '~/lib/form-state'
import { integerInputError } from '~/lib/integer-input'
import type { CommunityNode } from '../nodes/api'
import type { RiceSession } from '~/lib/models'
import { createTask, getTask, getTaskPage, publishTask, updateTask } from './api'
import type { RiceTask } from './types'
import { errorMessage } from '~/lib/util'

const MAX_TASK_CAPACITY = 1000

type ParticipationMode = 'single' | 'multiple'

function taskFields(draft: RiceTask | null | undefined, nodeId: string, editing = false) {
  const dateValue = (value?: string | null) => value ? (editing ? beijingDateTimeValue : roundedTimeValue)(value) : ''
  const multiple = (draft?.capacity ?? 1) > 1
  return {
    nodeId,
    fundingSource: (draft?.funding_source ?? (draft?.funding_node_id === null || !nodeId ? 'personal' : 'node')) as 'node' | 'personal',
    title: draft?.title ?? '',
    description: draft?.description ?? '',
    organizerContact: draft?.organizer_contact ?? '',
    requirement: draft?.requirement ?? '',
    applicationDeadline: dateValue(draft?.application_deadline),
    executionDeadline: dateValue(draft?.execution_deadline),
    rewardAmount: draft ? String(draft.reward_amount) : '',
    participationMode: (multiple ? 'multiple' : 'single') as ParticipationMode,
    multipleCapacity: multiple ? String(draft?.capacity) : '',
  }
}

export function TaskCreatePage({ session, nodes, initialDraft, initialError = '', editing = false, onPublished, onCloseStateChange }: { session: RiceSession; nodes: Array<Pick<CommunityNode, 'id' | 'name'>>; initialDraft?: RiceTask | null; initialError?: string; editing?: boolean; onPublished: (id: string) => void; onCloseStateChange: (state: FormCloseState) => void }) {
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const originalApplication = initialDraft?.application_deadline ? beijingDateTimeValue(initialDraft.application_deadline) : ''
  const originalExecution = initialDraft?.execution_deadline ? beijingDateTimeValue(initialDraft.execution_deadline) : ''
  const [fields, setFields] = useState(() => taskFields(initialDraft, initialDraft === undefined ? '' : initialDraft?.node?.id ?? nodes[0]?.id ?? '', editing))
  const { nodeId, fundingSource, title, description, organizerContact, requirement, applicationDeadline, executionDeadline, rewardAmount, participationMode, multipleCapacity } = fields
  const set = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => setFields((current) => ({ ...current, [key]: value }))
  const [taskId, setTaskId] = useState<string | null>(initialDraft?.id ?? null)
  const [draftLoading, setDraftLoading] = useState(initialDraft === undefined)
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef('')
  const imageSelection = useRiceImages(initialDraft?.attachments ?? [])
  const markSaved = useFormCloseState(JSON.stringify([nodeId, fundingSource, title, description, organizerContact, requirement, participationMode === 'single' ? 1 : multipleCapacity, applicationDeadline, executionDeadline, rewardAmount, imageSelection.images.map(image => image.src)]), !draftLoading, busy, onCloseStateChange, () => submit(editing ? 'open' : 'draft'))
  const restoreImages = imageSelection.restore
  useEffect(() => {
    if (initialDraft !== undefined) return
    let active = true; setDraftLoading(true)
    void getTaskPage({ data: { token: session.token, mine: 'created', status: 'draft', limit: 1 } }).then(({ data: [draft] }) => {
      if (!active) return
      const restoredNode = draft?.node?.id ?? nodes[0]?.id ?? ''
      if (draft) { setTaskId(draft.id); restoreImages(draft.attachments ?? []); setFields(taskFields(draft, restoredNode)) }
      else setFields(taskFields(null, restoredNode))
    }).catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setDraftLoading(false) })
    return () => { active = false }
  }, [session.token, restoreImages, nodes, initialDraft])
  if (draftLoading) return <LoadingState label="正在恢复草稿…" />
  const reopening = editing && (initialDraft?.status === 'cancelled' || initialDraft?.status === 'expired')
  const multiple = participationMode === 'multiple'
  const rewardLabel = multiple ? '每人稻米激励' : '稻米激励'
  const capacity = multiple ? Number(multipleCapacity) : 1
  const capacityError = participationMode === 'multiple' ? integerInputError(multipleCapacity, '承接人数上限', 2, MAX_TASK_CAPACITY) : null
  const rewardReadOnly = editing && ['open', 'in_progress', 'overdue', 'under_review'].includes(initialDraft?.status ?? '')
  const amountError = rewardAmount === '' ? null : integerInputError(rewardAmount, rewardLabel)
  const totalRewardAmount = !amountError && rewardAmount !== '' && !capacityError ? Number(rewardAmount) * capacity : null
  const totalRewardCopy = totalRewardAmount === null ? '待填写' : multiple ? `${rewardAmount} × ${capacity} = ${totalRewardAmount} 测试稻米` : `${totalRewardAmount} 测试稻米`
  // 没有可管的节点却能进到这里,说明是平台授权的个人发布者:奖励从自己的稻米里冻结
  const personal = nodes.length === 0
  const nodeMissing = !nodeId && !personal
  // 草稿是在还管着某个节点时存的,现在已不再管理:它仍属于那个节点,不能悄悄改成个人发起
  const lostNode = personal && !!nodeId ? '这份草稿属于你已不再管理的节点，不能改为个人发起。' : ''
  const fundingCopy = fundingSource === 'personal' ? '使用你自己的稻米，发布时冻结。' : '使用节点稻米，不扣个人稻米。'
  function validate(step: number): string | null {
    if (step === 0) {
      if (lostNode) return lostNode
      if (nodeMissing || !title.trim()) return personal ? '请填写任务标题。' : '请选择所属节点并填写任务标题。'
      if (!organizerContact.trim() || organizerContact.trim().length > 256) return '请填写组织方联系方式，最多 256 字。'
    }
    if (step === 1) {
      if (!description.trim() || !requirement.trim()) return '请填写任务说明和交付要求。'
      if (capacityError) return capacityError
    }
    if (step === 2) {
      if (!applicationDeadline) return '请选择申请截止日期和时间。'
      const deadline = beijingTime(applicationDeadline)
      if (!Number.isFinite(deadline)) return '请选择有效的申请截止日期和时间。'
      if ((!editing || reopening) && deadline <= Date.now()) return '申请截止应晚于当前时间。'
    }
    if (step === 3) {
      if (!executionDeadline) return '选一下最晚哪天交成果。'
      const deadline = beijingTime(executionDeadline)
      if (!Number.isFinite(deadline)) return '选一下最晚哪天交成果。'
      if ((!editing || reopening) && deadline <= Date.now()) return '交成果时间要晚于当前时间。'
      if (applicationDeadline && deadline <= beijingTime(applicationDeadline)) return '交成果时间要晚于申请截止。'
    }
    if (step === 4) return integerInputError(rewardAmount, rewardLabel)
    return null
  }
  async function submit(status: 'draft' | 'open'): Promise<boolean> {
    if (busy) return false
    if (lostNode) { setError(lostNode); return false }
    if (nodeMissing || !title.trim() || !description.trim() || !requirement.trim() || rewardAmount === '') { setError('请补齐标题、说明、交付要求和稻米数量。'); return false }
    if ((status === 'open' && !organizerContact.trim()) || organizerContact.trim().length > 256) { setError('请填写组织方联系方式，最多 256 字。'); return false }
    const inputError = capacityError ?? integerInputError(rewardAmount, rewardLabel)
    if (inputError) { setError(inputError); return false }
    const deadlineError = (status === 'open' || applicationDeadline ? validate(2) : null) ?? (status === 'open' || executionDeadline ? validate(3) : null)
    if (deadlineError) { setError(deadlineError); return false }
    setBusy(true); setError(''); setNotice('')
    if (!requestId.current) requestId.current = crypto.randomUUID()
    try {
      const attachmentIds = await imageSelection.upload(session.token)
      const fields = { attachmentIds, token: session.token, title, description, organizerContact: organizerContact.trim(), nodeId, fundingSource, requirement, capacity, applicationDeadline: applicationDeadline ? editing && applicationDeadline === originalApplication && initialDraft?.application_deadline ? initialDraft.application_deadline : beijingTimeIso(applicationDeadline) : null, executionDeadline: executionDeadline ? editing && executionDeadline === originalExecution && initialDraft?.execution_deadline ? initialDraft.execution_deadline : beijingTimeIso(executionDeadline) : null, rewardAmount: Number(rewardAmount || 0), clientRequestId: requestId.current }
      // New tasks get a recoverable draft before publishing.
      let draftId = taskId
      if (editing && !draftId) throw new Error('未找到要编辑的任务，请重新打开详情页。')
      if (!draftId) {
        const { data: [saved] } = await getTaskPage({ data: { token: session.token, mine: 'created', status: 'draft', limit: 1 } })
        if (saved && (saved.node?.id ?? '') !== nodeId) throw new Error('已有另一节点的任务草稿。请重新打开发布页面后继续编辑。')
        draftId = saved?.id ?? null
      }
      let task = draftId ? await getTask({ data: { token: session.token, id: draftId } }) : null
      if (editing && task?.allowed_actions.includes('edit')) {
        task = await updateTask({ data: { ...fields, taskId: draftId! } })
      } else if (editing) {
        throw new Error('此任务目前不能编辑。')
      } else if (task?.status === 'open' && status === 'open') {
        const iso = (date?: string | null) => date ? new Date(date).toISOString() : null
        const published = [task.title, task.description, task.organizer_contact ?? '', task.requirement ?? '', task.capacity ?? 1, task.reward_amount, task.funding_source ?? (task.funding_node_id ? 'node' : 'personal'), iso(task.application_deadline), iso(task.execution_deadline), (task.attachments ?? []).map((image) => image.id)]
        const requested = [title, description, organizerContact.trim(), requirement, fields.capacity, fields.rewardAmount, fields.fundingSource, fields.applicationDeadline, fields.executionDeadline, attachmentIds]
        if (JSON.stringify(published) !== JSON.stringify(requested)) throw new Error('这项任务已发布。请前往任务详情编辑。')
      } else {
        task = draftId
          ? await updateTask({ data: { ...fields, taskId: draftId } })
          : await createTask({ data: { ...fields, status: 'draft', applicationDeadline: fields.applicationDeadline ?? undefined } })
        setTaskId(task.id)
        if (status === 'open') task = await publishTask({ data: { token: session.token, taskId: task.id } })
      }
      if (!mounted.current) return false
      setTaskId(task.id)
      markSaved()
      if (status === 'draft') { setNotice('草稿已保存'); return true }
      window.dispatchEvent(new Event('rice-changed'))
      onPublished(task.id)
      return true
    } catch (e) { if (mounted.current) setError(errorMessage(e, '任务保存失败')); return false } finally { if (mounted.current) setBusy(false) }
  }
  const disabled = !!lostNode || nodeMissing || !title.trim() || !description.trim() || !requirement.trim() || rewardAmount === '' || !!amountError || !!capacityError || busy
  const nodeName = personal ? '个人发起' : nodes.find(node => node.id === nodeId)?.name ?? '未选择'
  return <section className="form-card task-compose-form">
    <PublishSteps busy={busy} error={error} notice={notice} onError={setError} validate={validate} canSaveDraft={!disabled && !editing} onSaveDraft={() => submit('draft')} onPublish={() => submit('open')} publishLabel={editing ? '保存修改' : '发布任务'} editing={editing} steps={[
      {
        label: '基本信息', title: '你想一起做什么？',
        content: <>
          {!personal && <label className="native-field">所属节点<select required value={nodeId} disabled={(!editing && !!taskId) || rewardReadOnly || busy} onChange={(e) => set('nodeId', e.target.value)}>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>}
          <PublishTextInput isDisabled={busy} label="任务标题" value={title} onChange={(v) => set('title', v.slice(0, 128))} width="100%" isRequired />
          <ContactField organizer value={organizerContact} onChange={(v) => set('organizerContact', v)} disabled={busy} />
        </>,
        review: <dl className="publish-review-fields"><div><dt>所属节点</dt><dd>{nodeName}</dd></div><div><dt>任务标题</dt><dd>{title}</dd></div><div><dt>组织方联系方式</dt><dd>{organizerContact.trim() || '未填写'}</dd></div></dl>,
      },
      {
        label: '内容', title: '把这件事说清楚。',
        content: <>
          <PublishTextArea isDisabled={busy} label="任务说明" value={description} onChange={(v) => set('description', v)} maxLength={4000} width="100%" isRequired />
          <PublishTextArea isDisabled={busy} label="交付要求" value={requirement} onChange={(v) => set('requirement', v)} maxLength={4000} width="100%" isRequired />
          <label className="native-field">承接方式
            <select aria-describedby="task-participation-help" value={participationMode} disabled={rewardReadOnly || busy} onChange={event => { set('participationMode', event.target.value as ParticipationMode); setError(''); setNotice('') }}>
              <option value="single">单人任务</option><option value="multiple">多人任务</option>
            </select>
          </label>
          <p id="task-participation-help" className="publish-guidance">复杂任务或只需一人承接，选择单人任务；简单且需多人分别完成，选择多人任务。多人任务需填写人数上限，每人独立交付和验收，稻米激励按第五步填写的每人数额发放。</p>
          {multiple && <PublishTextInput isDisabled={rewardReadOnly || busy} label="承接人数上限" value={multipleCapacity} onChange={value => { set('multipleCapacity', value); setError(''); setNotice('') }} status={multipleCapacity.trim() && capacityError ? { type: 'error', message: capacityError } : undefined} width="100%" isRequired />}
          <ImagePicker images={imageSelection.images} onSelect={imageSelection.select} onRemove={imageSelection.remove} disabled={busy} />
        </>,
        review: <><dl className="publish-review-fields"><div><dt>任务说明</dt><dd className="publish-review-text">{description}</dd></div><div><dt>交付要求</dt><dd className="publish-review-text">{requirement}</dd></div><div><dt>承接方式</dt><dd>{participationMode === 'single' ? '单人任务' : `多人任务，最多 ${multipleCapacity} 人`}</dd></div><div><dt>参考图片</dt><dd>{imageSelection.images.length ? `${imageSelection.images.length} 张` : '未添加'}</dd></div></dl><ImageGroup images={imageSelection.images} /></>,
      },
      {
        label: '申请截止', title: '什么时候截止申请？',
        content: <PublishSchedule disabled={busy} fields={[
          { label: '申请截止', value: applicationDeadline, min: editing && !reopening ? undefined : nextTimeSlot(), required: true, onChange: value => { set('applicationDeadline', value); if (value && executionDeadline && executionDeadline <= value) set('executionDeadline', addMinutes(value, 15)); setError('') } },
        ]} />,
        review: <dl className="publish-review-fields"><div><dt>申请截止</dt><dd>{applicationDeadline ? `${applicationDeadline.replace('T', ' ')}（北京时间）` : '未设置'}</dd></div></dl>,
      },
      {
        label: '最晚交成果', title: '最晚哪天交成果？',
        content: <PublishSchedule disabled={busy} fields={[
          { label: '最晚交成果', value: executionDeadline, min: editing && !reopening ? undefined : applicationDeadline ? addMinutes(applicationDeadline, 15) : nextTimeSlot(), required: true, onChange: value => { set('executionDeadline', value); setError('') } },
        ]} />,
        review: <dl className="publish-review-fields"><div><dt>最晚交成果</dt><dd>{executionDeadline ? `${executionDeadline.replace('T', ' ')}（北京时间）` : '未设置'}</dd></div></dl>,
      },
      {
        label: '参与与稻米', title: multiple ? '给每位承接者多少稻米？' : '给多少稻米？',
        content: <>{!personal && <label className="native-field">出资钱包<select value={fundingSource} disabled={rewardReadOnly || busy} onChange={e => set('fundingSource', e.target.value as 'node' | 'personal')}><option value="node">节点钱包</option><option value="personal">我的个人钱包</option></select></label>}<PublishTextInput isDisabled={busy} isReadOnly={rewardReadOnly} label={`${rewardLabel}（测试稻米）`} value={rewardAmount} onChange={v => { set('rewardAmount', v); setError(''); setNotice('') }} status={amountError ? { type: 'error', message: amountError } : undefined} width="100%" isRequired />{totalRewardAmount !== null && <p className={multiple ? 'publish-total' : 'muted'}>总冻结：{totalRewardCopy}</p>}<p className="muted">{fundingCopy}</p></>,
        review: <dl className="publish-review-fields">{multiple && <div><dt>承接人数上限</dt><dd>{capacity} 人</dd></div>}<div><dt>{rewardLabel}</dt><dd>{rewardAmount} 测试稻米</dd></div><div><dt>总冻结</dt><dd>{totalRewardCopy}</dd></div><div><dt>稻米从哪出</dt><dd>{fundingSource === 'personal' ? fundingCopy : `${nodeName}：${fundingCopy}`}</dd></div></dl>,
      },
    ]} />
  </section>
}
