import { PublishTextArea, PublishTextInput } from '~/components/PublishFields'
import { useEffect, useRef, useState } from 'react'
import { ContactField } from '~/components/ContactField'
import { ImageGroup, ImagePicker } from '~/components/ContentImages'
import { PublishSchedule } from '~/components/PublishSchedule'
import { LoadingState } from '~/components/LoadingState'
import { PublishSteps } from '~/components/PublishSteps'
import { useRiceImages } from '../media/useRiceImages'
import { addMinutes, beijingDateTimeValue, beijingTime, beijingTimeIso, MINUTE_MS, nextTimeSlot, roundedTimeValue, SLOT_MINUTES } from '~/lib/date-time'
import { useFormCloseState, type FormCloseState } from '~/lib/form-state'
import { integerInputError } from '~/lib/integer-input'
import type { CommunityNode } from '../nodes/api'
import type { RiceSession } from '~/lib/models'
import { getEvents, saveEvent, type RiceEvent } from './api'

const emptyFields = { node_id: '', title: '', description: '', organizer_contact: '', location: '', application_deadline: '', starts_at: '', ends_at: '', fee_amount: '0', capacity: '' }
type EventTimes = Pick<typeof emptyFields, 'application_deadline' | 'starts_at' | 'ends_at'>
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const DEFAULT_DURATION_MINUTES = 2 * MINUTES_PER_HOUR
const durations = [[MINUTES_PER_HOUR, '1 小时'], [DEFAULT_DURATION_MINUTES, '2 小时'], [3 * MINUTES_PER_HOUR, '3 小时'], [MINUTES_PER_DAY, '1 天'], [2 * MINUTES_PER_DAY, '2 天'], [3 * MINUTES_PER_DAY, '3 天']] as const

export function eventTimeError(fields: EventTimes, now = Date.now(), through: keyof EventTimes = 'ends_at', editing = false) {
  const deadline = beijingTime(fields.application_deadline)
  const starts = beijingTime(fields.starts_at)
  const ends = beijingTime(fields.ends_at)
  if (!Number.isFinite(deadline)) return '请选择有效的报名截止日期和时间。'
  if (deadline <= now && !editing) return '报名截止时间必须晚于当前时间。'
  if (through === 'application_deadline') return null
  if (!Number.isFinite(starts)) return '请选择有效的活动开始日期和时间。'
  if (deadline > starts) return '报名截止不能晚于活动开始时间。'
  if (starts <= now && !editing) return '活动开始时间必须晚于当前时间。'
  if (through === 'starts_at') return null
  if (!Number.isFinite(ends)) return '请选择有效的活动结束日期和时间。'
  if (starts >= ends) return '活动结束时间必须晚于开始时间。'
  if (ends <= now && !editing) return '活动结束时间必须晚于当前时间。'
  return null
}

export function changeEventTime<T extends EventTimes>(fields: T, key: keyof EventTimes, value: string, duration: string): T {
  const next = { ...fields, [key]: value }
  if (key === 'application_deadline' && value && (!next.starts_at || next.starts_at < value)) next.starts_at = value
  if (key !== 'ends_at' && next.starts_at && next.starts_at !== fields.starts_at) {
    const minutes = duration === 'custom' ? (beijingTime(fields.ends_at) - beijingTime(fields.starts_at)) / MINUTE_MS : Number(duration)
    next.ends_at = addMinutes(next.starts_at, minutes > 0 ? minutes : SLOT_MINUTES)
  }
  return next
}

const durationMinutes = (fields: EventTimes) => Math.round((beijingTime(fields.ends_at) - beijingTime(fields.starts_at)) / MINUTE_MS)
const durationValue = (fields: EventTimes) => durations.some(([minutes]) => minutes === durationMinutes(fields)) ? String(durationMinutes(fields)) : 'custom'
function draftFields(draft: RiceEvent, editing = false) {
  const dateValue = editing ? beijingDateTimeValue : roundedTimeValue
  const restored = { node_id: draft.node.id, title: draft.title, description: draft.description, organizer_contact: draft.organizer_contact ?? '', location: draft.location, application_deadline: dateValue(draft.application_deadline), starts_at: dateValue(draft.starts_at), ends_at: dateValue(draft.ends_at), fee_amount: String(draft.fee_amount), capacity: String(draft.capacity) }
  if (!editing && restored.ends_at <= restored.starts_at) restored.ends_at = addMinutes(restored.starts_at, SLOT_MINUTES)
  return restored
}
export function eventDurationLabel(fields: EventTimes) {
  const minutes = durationMinutes(fields)
  if (!(minutes > 0)) return '请选择有效的开始和结束时间'
  const days = Math.floor(minutes / MINUTES_PER_DAY)
  const hours = Math.floor(minutes % MINUTES_PER_DAY / MINUTES_PER_HOUR)
  const remainder = minutes % MINUTES_PER_HOUR
  return [days ? `${days} 天` : '', hours ? `${hours} 小时` : '', remainder ? `${remainder} 分钟` : ''].filter(Boolean).join(' ')
}

export function EventCreateForm({ session, nodes, initialDraft, initialError = '', editing = false, onPublished, onCloseStateChange }: { session: RiceSession; nodes: Array<Pick<CommunityNode, 'id' | 'name'>>; initialDraft?: RiceEvent | null; initialError?: string; editing?: boolean; onPublished: (id: string) => void; onCloseStateChange: (state: FormCloseState) => void }) {
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [fields, setFields] = useState(() => { if (initialDraft) return draftFields(initialDraft, editing); const start = nextTimeSlot(); return { ...emptyFields, node_id: initialDraft === null ? nodes[0]?.id ?? '' : '', application_deadline: start, starts_at: start, ends_at: addMinutes(start, DEFAULT_DURATION_MINUTES) } })
  const [duration, setDuration] = useState(() => initialDraft ? durationValue(fields) : String(DEFAULT_DURATION_MINUTES))
  const [draftId, setDraftId] = useState<string | undefined>(initialDraft?.id)
  const [loading, setLoading] = useState(initialDraft === undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  const requestId = useRef('')
  const imageSelection = useRiceImages(initialDraft?.attachments ?? [])
  const markSaved = useFormCloseState(JSON.stringify([fields, imageSelection.images.map(image => image.src)]), !loading, busy, onCloseStateChange, () => submit(editing ? 'open' : 'draft'))
  const restoreImages = imageSelection.restore
  const set = (key: keyof typeof fields, value: string) => { setFields((f) => ({ ...f, [key]: value })); setError(''); setNotice('') }
  const setTime = (key: keyof EventTimes, value: string) => {
    const next = changeEventTime(fields, key, value, duration)
    setFields(next); setError(''); setNotice('')
    if (key === 'ends_at') setDuration(durationValue(next))
  }
  useEffect(() => {
    if (initialDraft !== undefined) return
    let active = true
    void getEvents({ data: { token: session.token, mine: 'created', status: 'draft' } }).then((page) => {
      if (!active) return
      const draft = page.data[0]
      if (draft) {
        const restored = draftFields(draft)
        setDraftId(draft.id); restoreImages(draft.attachments ?? []); setFields(restored); setDuration(durationValue(restored))
      }
      else setFields((f) => ({ ...f, node_id: nodes[0]?.id ?? '' }))
    }).catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session.token, restoreImages, nodes, initialDraft])
  if (loading) return <LoadingState label="正在恢复草稿…" />
  const allowPastDates = editing && initialDraft?.status !== 'cancelled'
  const originalTimes = editing && initialDraft ? draftFields(initialDraft, true) : undefined
  async function submit(status: 'draft' | 'open'): Promise<boolean> {
    if (busy) return false
    if (!fields.node_id || !fields.title.trim() || !fields.description.trim() || !fields.location.trim() || Number(fields.capacity) < 1) { setError('请先填写活动标题、介绍、地点和名额。'); return false }
    if ((status === 'open' && !fields.organizer_contact.trim()) || fields.organizer_contact.trim().length > 256) { setError('请填写组织方联系方式，最多 256 字。'); return false }
    const numberError = integerInputError(fields.fee_amount, '报名稻米') || integerInputError(fields.capacity, '参与名额', 1, 100_000)
    if (numberError) { setError(numberError); return false }
    const timeError = eventTimeError(fields, Date.now(), 'ends_at', allowPastDates)
    if (timeError) { setError(timeError); return false }
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setBusy(true); setError(''); setNotice('')
    try {
      const attachment_ids = await imageSelection.upload(session.token)
      const dateField = (key: keyof EventTimes) => editing && initialDraft && fields[key] === originalTimes?.[key] ? initialDraft[key] : beijingTimeIso(fields[key])
      const event = await saveEvent({ data: { token: session.token, id: draftId, editing, status, fields: { ...fields, attachment_ids, fee_amount: Number(fields.fee_amount), capacity: Number(fields.capacity), application_deadline: dateField('application_deadline'), starts_at: dateField('starts_at'), ends_at: dateField('ends_at'), client_request_id: requestId.current } } })
      if (!mounted.current) return false
      setDraftId(event.id)
      markSaved()
      if (status === 'draft') { setNotice('草稿已保存'); return true }
      window.dispatchEvent(new Event('rice-changed'))
      onPublished(event.id)
      return true
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '保存失败'); return false } finally { if (mounted.current) setBusy(false) }
  }
  const amountError = fields.fee_amount === '' ? null : integerInputError(fields.fee_amount, '报名稻米')
  const feeReadOnly = editing && ['open', 'in_progress'].includes(initialDraft?.status ?? '')
  const capacityError = fields.capacity === '' ? null : integerInputError(fields.capacity, '参与名额', 1, 100_000)
  const disabled = busy || !fields.node_id || !fields.title.trim() || !fields.description.trim() || !fields.location.trim() || !fields.application_deadline || !fields.starts_at || !fields.ends_at || fields.fee_amount === '' || fields.capacity === '' || !!amountError || !!capacityError
  const nodeName = nodes.find(node => node.id === fields.node_id)?.name ?? fields.node_id
  const validate = (step: number) => {
    if (step === 0) {
      if (!fields.node_id || !fields.title.trim()) return '请选择所属节点并填写活动标题。'
      if (!fields.organizer_contact.trim() || fields.organizer_contact.trim().length > 256) return '请填写组织方联系方式，最多 256 字。'
    }
    if (step === 1 && (!fields.description.trim() || !fields.location.trim())) return '请填写活动介绍和地点。'
    if (step === 2) return eventTimeError(fields, Date.now(), 'application_deadline', allowPastDates)
    if (step === 3) return eventTimeError(fields, Date.now(), 'starts_at', allowPastDates)
    if (step === 4) return eventTimeError(fields, Date.now(), 'ends_at', allowPastDates)
    if (step === 5) return integerInputError(fields.capacity, '参与名额', 1, 100_000) || integerInputError(fields.fee_amount, '报名稻米')
    return null
  }
  return <section className="form-card event-compose-form">
    <PublishSteps busy={busy} error={error} notice={notice} onError={setError} validate={validate} canSaveDraft={!disabled && !editing} onSaveDraft={() => submit('draft')} onPublish={() => submit('open')} publishLabel={editing ? '保存修改' : '发布活动'} editing={editing} steps={[
      {
        label: '基本信息', title: '你想一起做什么？',
        content: <>
          <label className="native-field">所属节点<select required disabled={busy || feeReadOnly} value={fields.node_id} onChange={(e) => set('node_id', e.target.value)}>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
          <PublishTextInput isDisabled={busy} label="活动标题" value={fields.title} onChange={(v) => set('title', v.slice(0, 128))} width="100%" isRequired />
          <ContactField organizer value={fields.organizer_contact} onChange={v => set('organizer_contact', v)} disabled={busy} />
        </>,
        review: <dl className="publish-review-fields"><div><dt>所属节点</dt><dd>{nodeName}</dd></div><div><dt>活动标题</dt><dd>{fields.title}</dd></div><div><dt>组织方联系方式</dt><dd>{fields.organizer_contact.trim() || '未填写'}</dd></div></dl>,
      },
      {
        label: '内容', title: '把这件事说清楚。',
        content: <>
          <PublishTextArea isDisabled={busy} label="活动介绍" value={fields.description} onChange={(v) => set('description', v)} maxLength={4000} width="100%" isRequired />
          <PublishTextInput isDisabled={busy} label="活动地点" value={fields.location} onChange={(v) => set('location', v)} width="100%" isRequired />
          <ImagePicker images={imageSelection.images} onSelect={imageSelection.select} onRemove={imageSelection.remove} disabled={busy} />
        </>,
        review: <><dl className="publish-review-fields"><div><dt>活动介绍</dt><dd className="publish-review-text">{fields.description}</dd></div><div><dt>活动地点</dt><dd>{fields.location}</dd></div><div><dt>图片</dt><dd>{imageSelection.images.length ? `${imageSelection.images.length} 张图片` : '未添加'}</dd></div></dl><ImageGroup images={imageSelection.images} /></>,
      },
      {
        label: '报名截止', title: '什么时候截止报名？',
        content: <PublishSchedule disabled={busy} fields={[
          { label: '报名截止', value: fields.application_deadline, min: allowPastDates ? undefined : nextTimeSlot(), required: true, onChange: value => setTime('application_deadline', value) },
        ]} />,
        review: <dl className="publish-review-fields"><div><dt>报名截止（北京时间）</dt><dd>{fields.application_deadline.replace('T', ' ')}</dd></div></dl>,
      },
      {
        label: '开始时间', title: '活动什么时候开始？',
        content: <PublishSchedule disabled={busy} fields={[
          { label: '开始时间', value: fields.starts_at, min: allowPastDates ? undefined : fields.application_deadline || nextTimeSlot(), required: true, onChange: value => setTime('starts_at', value) },
        ]} />,
        review: <dl className="publish-review-fields"><div><dt>开始时间（北京时间）</dt><dd>{fields.starts_at.replace('T', ' ')}</dd></div></dl>,
      },
      {
        label: '结束时间', title: '活动什么时候结束？',
        content: <PublishSchedule disabled={busy} fields={[
          { label: '结束时间', value: fields.ends_at, min: allowPastDates ? undefined : fields.starts_at ? addMinutes(fields.starts_at, SLOT_MINUTES) : nextTimeSlot(), required: true, onChange: value => setTime('ends_at', value) },
        ]}>
          <label className="native-field">持续时长<select value={duration} disabled={busy} onChange={event => { const value = event.target.value; setDuration(value); if (value !== 'custom' && fields.starts_at) set('ends_at', addMinutes(fields.starts_at, Number(value))) }}>{durations.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}<option value="custom">自定义</option></select></label>
          <p className="muted">实际时长：{eventDurationLabel(fields)}</p>
        </PublishSchedule>,
        review: <dl className="publish-review-fields"><div><dt>结束时间（北京时间）</dt><dd>{fields.ends_at.replace('T', ' ')}</dd></div><div><dt>持续时长</dt><dd>{eventDurationLabel(fields)}</dd></div></dl>,
      },
      {
        label: '参与与稻米', title: '一起怎么参与？',
        content: <>
          <PublishTextInput isDisabled={busy} label="参与名额" value={fields.capacity} onChange={(v) => set('capacity', v)} status={capacityError ? { type: 'error', message: capacityError } : undefined} width="100%" isRequired />
          <PublishTextInput isDisabled={busy} isReadOnly={feeReadOnly} label="每人报名收取稻米（0 表示无需稻米）" description="活动结束确认后，稻米结算至所选节点账户。" value={fields.fee_amount} onChange={(v) => set('fee_amount', v)} status={amountError ? { type: 'error', message: amountError } : undefined} width="100%" isRequired />
        </>,
        review: <><dl className="publish-review-fields"><div><dt>参与名额</dt><dd>{fields.capacity}</dd></div><div><dt>每人报名收取稻米</dt><dd>{Number(fields.fee_amount) === 0 ? '无需稻米' : `${fields.fee_amount} 测试稻米`}</dd></div></dl><p className="muted">活动结束确认后，稻米结算至所选节点账户。</p></>,
      },
    ]} />
  </section>
}
