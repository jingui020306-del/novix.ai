import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useDraftRecovery } from '../lib/editorDrafts'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'
import { fieldLabel } from './SchemaForm'
import { WorldContextFields } from './WorldContextFields'
import { TokenUsage } from './WritingTools'

const KINDS: Record<string, string> = { story: '故事摘要', character: '人物', world: '世界条目', relationship: '共享关系', event: '事件', worksheet: '工作表', fact: '事实候选', style: '文风' }
const CLASSIFICATION: Record<string, string> = { new: '新增资料', supplement: '补充原资料', conflict: '与原资料不同，需判断' }

export function MaterialImportWorkspace({ project, purpose, storyId, worldContext, profileId, onApplied, isTargetDirty }: {
  project: string; purpose: 'story' | 'world' | 'relations' | 'style'; storyId?: string; worldContext?: any; profileId?: string; onApplied?: () => void; isTargetDirty?: (id: string) => boolean;
}) {
  const { data: stories } = useSWR(`/api/projects/${project}/cards?type=story`, api.get)
  const { data: materials } = useSWR(`/api/projects/${project}/materials`, api.get)
  const [chosenStory, setChosenStory] = useState('')
  const targetStory = storyId && storyId !== 'story_new' ? storyId : chosenStory
  const key = `novix:material-work:${project}:${purpose}:${storyId || ''}`
  const [kind, setKind] = useState('text')
  const [text, setText] = useState('')
  const [referenceScope, setReferenceScope] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [work, setWork] = useState<any>(null)
  const [remoteWork, setRemoteWork] = useState<any>(null)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [needsRebase, setNeedsRebase] = useState(false)
  const [manualKind, setManualKind] = useState(purpose === 'relations' ? 'relationship' : purpose)
  const entry = { kind, text, url, referenceScope, chosenStory }
  const entryRecovery = useDraftRecovery(`${key}:entry`, entry, JSON.stringify({ kind: 'text', text: '', url: '', referenceScope: '', chosenStory: '' }), (value) => { setKind(value.kind || 'text'); setText(value.text || ''); setUrl(value.url || ''); setReferenceScope(value.referenceScope || ''); setChosenStory(value.chosenStory || '') })
  const request = useRef(0)
  const currentKey = useRef(key)
  currentKey.current = key
  const latest = useRef(work)
  latest.current = work
  const contentKey = (value: any) => JSON.stringify({ cleaned_text: value?.cleaned_text || '', skeleton: value?.skeleton, candidates: value?.candidates || [] })
  const dirty = Boolean(work && contentKey(work) !== saved)
  const localDraft = useDraftRecovery(`${key}:batch:${work?.id || 'new'}`, work, work && saved ? JSON.stringify({ ...work, ...JSON.parse(saved) }) : '', setWork)
  const applied = ['applied', 'applying', 'undoing', 'undone'].includes(work?.status)
  const needsStory = (work?.candidates || []).some((candidate: any) => ['event', 'worksheet'].includes(candidate.kind) && candidate.selected !== false) && !work?.story_card_id
  const conflictsPending = (work?.candidates || []).some((candidate: any) => candidate.selected !== false && candidate.classification === 'conflict' && (!candidate.decision?.mode || ['fill', 'replace'].includes(candidate.decision?.mode) && !candidate.decision?.target_id && !candidate.target_id))
  useEffect(() => {
    const number = ++request.current
    setWork(null); setRemoteWork(null); setSaved(''); setMessage(''); setNeedsRebase(false); setText(''); setUrl(''); setReferenceScope(''); setFile(null); setBusy(''); setChosenStory('')
    const id = localStorage.getItem(key)
    if (id) void api.get(`/api/projects/${project}/material-imports/${encodeURIComponent(id)}`).then((value) => { if (number !== request.current) return; setWork(value); setSaved(contentKey(value)) }).catch((error) => { if (number === request.current) setMessage(error.message) })
    return () => { request.current++ }
  }, [key])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  useEffect(() => {
    if (!work?.id || !['extracting', 'applying', 'undoing'].includes(work.status) && !['ai', 'local'].includes(busy)) return
    const timer = window.setInterval(() => { void api.get(`/api/projects/${project}/material-imports/${work.id}`).then((fresh) => { if (currentKey.current !== key) return; setWork((current: any) => current?.id === fresh.id ? { ...current, status: fresh.status, error: fresh.error, usage: fresh.usage, source: fresh.source } : current) }).catch(() => {}) }, 1800)
    return () => window.clearInterval(timer)
  }, [work?.id, work?.status, busy, key])
  const update = (patch: any) => setWork((value: any) => ({ ...value, ...patch }))
  const saveWork = async () => {
    const held = latest.current
    if (!held) return null
    const result = await api.put(`/api/projects/${project}/material-imports/${held.id}`, { base_revision: held.revision, cleaned_text: held.cleaned_text || '', skeleton: held.skeleton, candidates: held.candidates || [] })
    if (currentKey.current !== key) return null
    setSaved(contentKey(held))
    setWork((current: any) => current?.id === held.id ? { ...current, revision: result.revision } : current)
    return { ...held, ...result }
  }
  const run = async (action: 'create' | 'save' | 'local' | 'ai' | 'apply' | 'undo' | 'cancel' | 'rebase') => {
    const number = ++request.current
    setBusy(action); setMessage('')
    const before = latest.current ? contentKey(latest.current) : ''
    try {
      let result: any
      if (action === 'apply' && (work?.candidates || []).some((candidate: any) => { if (candidate.selected === false || ['new', 'add', 'skip'].includes(candidate.decision?.mode)) return false; const target = candidate.decision?.target_id || candidate.target_id || (candidate.kind === 'story' ? work.story_card_id : ['event', 'worksheet'].includes(candidate.kind) && work.story_card_id ? `outline_planning_${work.story_card_id}` : ''); return target && isTargetDirty?.(target.split(':')[0]) })) throw new Error('采用目标还有未保存的编辑。请先保存或核对那份原稿，本批工作稿仍保留。')
      if (action === 'apply' && (needsStory || conflictsPending)) throw new Error(needsStory ? '本批事件需要明确的所属故事。请先保存 / 选择故事，再建立对应的材料工作稿。当前候选保留。' : '请逐项决定冲突候选是补充、替换、独立新增还是跳过。')
      if (action === 'create') {
        if (purpose === 'story' && !targetStory) throw new Error('请先选择所属故事，或在故事页保存当前新故事，再读入材料。')
        if (work && dirty) throw new Error('当前工作稿还有未保存修改，请先保存，再导入另一份材料。')
        if (kind === 'file' || kind === 'image') {
          if (!file) throw new Error('请先选择要导入的文件。')
          const form = new FormData(); form.append('file', file); form.append('purpose', purpose); form.append('world_context', JSON.stringify(worldContext || {})); form.append('reference_scope', referenceScope); if (targetStory) form.append('story_card_id', targetStory)
          result = await api.upload(`/api/projects/${project}/material-imports/upload`, form)
        } else result = await api.post(`/api/projects/${project}/material-imports`, { purpose, story_card_id: targetStory, world_context: worldContext, reference_scope: referenceScope || undefined, ...(kind === 'url' ? { url } : { text }) })
      } else {
        const held = action === 'cancel' ? await api.get(`/api/projects/${project}/material-imports/${latest.current.id}`) : dirty && !applied ? await saveWork() : latest.current
        if (!held || currentKey.current !== key) return
        if (action === 'save') { setMessage('工作稿已保存，可随时返回继续整理。'); return }
        const body = action === 'local' || action === 'ai' ? { base_revision: held.revision, use_ai: action === 'ai', llm_profile_id: profileId } : action === 'apply' ? { base_revision: held.revision, selected_ids: (held.candidates || []).filter((row: any) => row.selected !== false && row.decision?.mode !== 'skip').map((row: any) => row.id), decisions: Object.fromEntries((held.candidates || []).map((row: any) => [row.id, row.decision || { mode: row.classification === 'conflict' ? 'skip' : 'fill', ...(row.target_id ? { target_id: row.target_id } : {}) }])) } : { base_revision: held.revision }
        result = await api.post(`/api/projects/${project}/material-imports/${held.id}/${action === 'local' || action === 'ai' ? 'extract' : action}`, body)
      }
      if (number !== request.current || currentKey.current !== key) return
      if (action !== 'create' && before !== contentKey(latest.current)) { setRemoteWork(result.work || result.batch || result); setMessage('等待期间你又修改了工作稿，当前编辑保留。请保存后重新读取本批结果。'); return }
      const next = result.work || result.batch || result
      if (action === 'cancel') { setWork((current: any) => ({ ...current, status: next.status || 'cancelled', revision: next.revision || current.revision })); setMessage('本批已取消，当前手动编辑仍保留，晚到 AI 结果不会自动采用。'); return }
      if (action === 'rebase') setNeedsRebase(false)
      if (action === 'create') localStorage.removeItem(`novix:draft:${key}:entry`)
      if (next.id && next.revision) { setWork(next); setSaved(contentKey(next)); localStorage.setItem(key, next.id) }
      else if (work?.id) { const fresh = await api.get(`/api/projects/${project}/material-imports/${work.id}`); if (number !== request.current) return; setWork(fresh); setSaved(contentKey(fresh)) }
      if (action === 'apply' || action === 'undo') onApplied?.()
      setMessage(action === 'rebase' ? '已读取最新目标资料并重算冲突。请查看下方最新目标摘要，再次决定如何分配；作者工作稿未被替换。' : action === 'apply' ? '所选候选已按本批确认应用。原材料和变更记录保留。' : action === 'undo' ? '已请求撤销本批；后来另行修改的内容不会被覆盖。' : action === 'ai' ? 'AI 候选已生成，仍需逐项判断和确认。' : action === 'local' ? '已完成本地整理；无法确定的内容留空，可手动补充或主动请 AI 提取。' : '材料已读入工作稿，请先核对成功读取的范围。')
    } catch (error) { if (number === request.current && currentKey.current === key) { setMessage(error instanceof Error ? error.message : '操作未完成，当前编辑保留。'); if ((error as any)?.status === 409) setNeedsRebase(true); if (latest.current?.id) { try { const fresh = await api.get(`/api/projects/${project}/material-imports/${latest.current.id}`); if (number !== request.current) return; if (before === contentKey(latest.current)) { setWork(fresh); setSaved(contentKey(fresh)) } else setRemoteWork(fresh) } catch {} } } }
    finally { if (number === request.current) setBusy('') }
  }
  const editCandidate = (index: number, patch: any) => update({ candidates: (work.candidates || []).map((row: any, i: number) => i === index ? { ...row, ...patch } : row) })
  const labels: Record<string, string> = { participants: '参与者', entity_id: '对应人物 / 实体', character_id: '对应人物', characters: '涉及人物', role: '在关系中的身份', direction: '关系方向', notes: '说明', changes: '阶段变化', knowledge: '已知内容', value: '内容', row: '工作表这一行', table: '对应工作表', record_kind: '人物资料深度', target_id: '对应资料', address_as: '对此人的称呼', style_guide: '文风细节', pov: '叙述视角' }
  const readable = (value: any): string => value == null ? '空白' : Array.isArray(value) ? value.map(readable).join('、') : typeof value === 'object' ? Object.entries(value).filter(([key]) => !['id', '_revision'].includes(key)).map(([key, item]) => `${labels[key] || fieldLabel(key)}：${readable(item)}`).join('；') : (Array.isArray(materials) ? materials : []).find((row: any) => row.id === value)?.label || String(value)
  const addManualCandidate = () => {
    const values: any = ({ story: { logline: '', main_conflict: '', theme: '' }, character: { name: '', identity: '', record_kind: 'mention' }, world: { title: '', summary: '', content: '' }, relationship: { label: '', participants: [{ entity_id: '', role: '' }, { entity_id: '', role: '' }], direction: 'undirected', notes: '' }, event: { scene: '', plot: '', purpose: '', characters: [], chapter: '' }, style: { tone: '', rules: [], style_guide: { pov: '' } } } as Record<string, any>)[manualKind]
    update({ candidates: [...(work.candidates || []), { id: `candidate_${crypto.randomUUID().replace(/-/g, '')}`, kind: manualKind, label: `手动整理的${KINDS[manualKind]}`, classification: 'new', values, evidence: [], selected: true, decision: { mode: 'fill' } }] })
  }
  const editValues = (values: any, change: (value: any) => void): any => <div className='space-y-3'>{Object.entries(values).map(([field, value]: any) => {
    const updateField = (next: any) => change({ ...values, [field]: next })
    if (['id', '_revision', 'source_key'].includes(field)) return null
    const label = labels[field] || fieldLabel(field)
    if (['entity_id', 'character_id', 'target_id'].includes(field)) return <div key={field}><label className='mb-1 block text-xs text-muted'>{label}</label><Select disabled={applied} value={value || ''} onChange={(e) => updateField(e.target.value)}><option value=''>原文未对应到已有资料</option>{value && !(materials || []).some?.((row: any) => row.id === value) && <option value={value}>原文中的对象（待核对映射）</option>}{(Array.isArray(materials) ? materials : []).map((row: any) => <option key={row.id} value={row.id}>{row.label || '未命名资料'}</option>)}</Select></div>
    if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) return <fieldset key={field} className='space-y-3 border-t border-border pt-3'><legend className='text-xs text-muted'>{label}</legend>{value.map((item: any, i: number) => <div key={i}>{editValues(item, (next) => updateField(value.map((row: any, index: number) => index === i ? next : row)))}</div>)}</fieldset>
    if (value && typeof value === 'object' && !Array.isArray(value)) return <details key={field}><summary className='cursor-pointer text-xs text-brand-600'>{label}</summary><div className='mt-3'>{editValues(value, updateField)}</div></details>
    if (field === 'direction' || field === 'record_kind') return <div key={field}><label className='mb-1 block text-xs text-muted'>{label}</label><Select disabled={applied} value={value || ''} onChange={(e) => updateField(e.target.value)}>{Object.entries(field === 'direction' ? { directed: '有方向的关系', undirected: '共同关系' } : { mention: '轻量出场人物', full: '完整人物卡' }).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></div>
    if (Array.isArray(value) && ['characters', 'known_by', 'entity_ids'].includes(field)) return <fieldset key={field} className='space-y-2'><legend className='text-xs text-muted'>{label}</legend>{(Array.isArray(materials) ? materials : []).filter((row: any) => row.type === 'character').map((row: any) => <label key={row.id} className='flex items-center gap-2 text-xs'><input type='checkbox' disabled={applied} checked={value.includes(row.id)} onChange={(event) => updateField(event.target.checked ? [...value, row.id] : value.filter((id: string) => id !== row.id))} />{row.label}</label>)}{value.filter((id: string) => !(materials || []).some?.((row: any) => row.id === id)).map((id: string, i: number) => <p key={i} className='text-xs text-muted'>未映射的原文对象（保留待核对）</p>)}</fieldset>
    if (Array.isArray(value)) return <div key={field}><label className='mb-1 block text-xs text-muted'>{label}</label><Textarea readOnly={applied} value={value.join('\n')} onChange={(e) => updateField(e.target.value.split('\n'))} /></div>
    return <div key={field}><label className='mb-1 block text-xs text-muted'>{label}</label><Textarea readOnly={applied} value={String(value ?? '')} onChange={(e) => updateField(typeof value === 'number' ? Number(e.target.value) : e.target.value)} /></div>
  })}</div>
  return <section className='space-y-4' aria-label='材料导入与整理'>
    <p className='text-sm leading-7 text-muted'>导入原材料，整理可修订的工作稿，再选择要分配的内容。无需按固定步骤完成，工作稿可以反复保存。</p>
    <div className='flex flex-wrap items-end gap-3'><div><label className='mb-1 block text-xs text-muted' htmlFor={`import-kind-${purpose}`}>从哪里导入</label><Select id={`import-kind-${purpose}`} value={kind} onChange={(e) => setKind(e.target.value)}><option value='text'>粘贴文字</option><option value='file'>文字 / Word / PDF 文件</option><option value='image'>图片或扫描件</option><option value='url'>网页链接</option></Select></div><Button disabled={Boolean(busy) || purpose === 'story' && !targetStory || (kind === 'text' ? !text.trim() : kind === 'url' ? !url.trim() : !file)} onClick={() => run('create')}>{busy === 'create' ? '读取中…' : '读入材料'}</Button></div>
    {!storyId || storyId === 'story_new' ? <div><label className='mb-1 block text-sm text-muted' htmlFor={`import-story-${purpose}`}>所属故事{purpose === 'story' ? '' : '（有事件时需要）'}</label><Select id={`import-story-${purpose}`} disabled={Boolean(work)} value={chosenStory} onChange={(e) => setChosenStory(e.target.value)}><option value=''>先选择故事</option>{(Array.isArray(stories) ? stories : []).map((story: any) => <option key={story.id} value={story.id}>{story.title || '未命名故事'}</option>)}</Select>{purpose === 'story' && !targetStory && <p className='mt-2 text-xs text-muted'>要整理当前尚未保存的新故事，请先点击页面的“保存故事设定”；材料不会被分配到一个不存在的故事。</p>}</div> : null}
    <details><summary className='cursor-pointer text-xs text-muted'>指定原材料版本 / 采用范围（可选）</summary><Input className='mt-3' aria-label='希望采用的原材料范围' value={referenceScope} onChange={(e) => setReferenceScope(e.target.value)} placeholder='例如：只取第二章中的世界规则；按此链接的当前版本。' /><p className='mt-2 text-xs text-muted'>范围说明随本批保留；仍需核对实际读取范围与引用，不从标题冒充全文。</p></details>
    {entryRecovery.recovery && <div className='flex flex-wrap items-center gap-2 border-y border-border py-3'><p className='text-sm'>找到尚未读入的本地文字或链接。</p><Button onClick={entryRecovery.restore}>恢复输入</Button><Button variant='ghost' onClick={entryRecovery.dismiss}>放弃这份输入</Button></div>}
    {localDraft.recovery && <div className='space-y-2 border-y border-border py-3'><p className='text-sm'>找到本批的本地未保存工作稿。</p><div className='flex gap-2'><Button onClick={localDraft.restore}>恢复工作稿</Button><Button variant='ghost' onClick={localDraft.dismiss}>保留服务端版</Button></div></div>}
    {kind === 'text' ? <Textarea aria-label='待导入的原文字' className='min-h-36' value={text} onChange={(e) => setText(e.target.value)} placeholder='粘贴已有故事、资料或创作想法。' /> : kind === 'url' ? <div className='space-y-2'><Input aria-label='原材料网页链接' type='url' value={url} onChange={(e) => setUrl(e.target.value)} placeholder='https://…' /><p className='text-xs text-muted'>只按实际读取到的内容整理。登录限制或部分读取会明确提示。</p></div> : <div className='space-y-2'><input aria-label='选择原材料文件' type='file' accept={kind === 'image' ? 'image/png,image/jpeg' : '.txt,.md,.doc,.docx,.pdf'} onChange={(e) => setFile(e.target.files?.[0] || null)} /><p className='text-xs text-muted'>{kind === 'image' ? '读图或扫描识别需要主动选择支持视觉的模型；图片不会自动变成已确认事实。' : '读取后会保留原文件与实际提取范围。'}</p></div>}
    {remoteWork && <section className='space-y-3 border-y border-border py-4'><p className='text-sm leading-7'>服务端工作稿有了新结果，当前手动编辑仍在。请明确选择如何继续，不自动覆盖。</p><div className='flex flex-wrap gap-2'><Button onClick={() => { const held = latest.current; const ids = new Set((held?.candidates || []).map((row: any) => row.id)); const next = { ...remoteWork, cleaned_text: held?.cleaned_text || '', candidates: [...(held?.candidates || []), ...(remoteWork.candidates || []).filter((row: any) => !ids.has(row.id))] }; setWork(next); setSaved(contentKey(remoteWork)); setRemoteWork(null); setMessage('已保留你的清理稿与候选编辑，新的候选另加在列表中，请重新核对后保存。') }}>保留手稿，合并新候选供核对</Button><Button variant='ghost' onClick={() => { setWork(remoteWork); setSaved(contentKey(remoteWork)); setRemoteWork(null); localDraft.dismiss() }}>改用服务端工作稿</Button></div></section>}
    {work && <fieldset disabled={busy === 'apply' || busy === 'undo'} className='min-w-0 space-y-4 border-t border-border pt-4'><div className='flex flex-wrap items-baseline justify-between gap-3'><h3 className='font-medium'>当前材料工作稿</h3><span className='text-xs text-muted'>{busy ? '正在处理…' : dirty ? '尚未保存的编辑' : ({ draft: '工作稿已保存', ready: '候选待确认', extracting: '正在提取', failed: '提取未完成', applied: '本批已应用', cancelled: '本批已取消', undone: '本批已撤销', applying: '正在应用', undoing: '正在撤销' } as Record<string, string>)[work.status] || '工作稿已保存'}</span></div><details><summary className='cursor-pointer text-sm text-brand-600'>回看原材料与读取范围</summary><div className='mt-3 space-y-2 text-xs leading-6 text-muted'>{work.source?.filename && <p>文件：{work.source.filename}</p>}{work.source?.url && <a className='text-brand-600 underline' href={work.source.url} target='_blank' rel='noreferrer'>打开原网页</a>}{(work.source?.filename || work.source?.url_preview) && <a className='block text-brand-600 underline' href={work.source?.url_preview || `/api/projects/${project}/material-imports/${work.id}/source`} target='_blank' rel='noreferrer'>查看本批原文件 / 图片</a>}<p className='whitespace-pre-wrap'>{work.source?.original_text || work.source?.text || '原文件保留，可通过上方来源查看。'}</p>{work.source?.coverage && <p>{typeof work.source.coverage === 'string' ? work.source.coverage : work.source.coverage.partial ? '只成功读取部分材料；未读取部分不作为依据。' : '按本次实际读取范围整理。'}</p>}</div></details><label className='block text-sm font-medium' htmlFor={`import-clean-${purpose}`}>清理后的文字，可直接修订</label><Textarea id={`import-clean-${purpose}`} className='min-h-44' readOnly={applied} value={work.cleaned_text || ''} onChange={(e) => update({ cleaned_text: e.target.value })} /><div className='flex flex-wrap gap-2'><Button disabled={Boolean(busy) || applied} onClick={() => run('save')}>保存工作稿</Button><Button disabled={Boolean(busy) || applied} onClick={() => run('local')}>本地整理</Button><Button disabled={Boolean(busy) || applied} onClick={() => run('ai')}>请 AI 提取候选</Button></div><p className='text-xs leading-6 text-muted'>本地整理、保存和分配不调用模型。只有“请 AI 提取候选”主动调用模型，候选不会直接覆盖作者资料。</p>
      {needsRebase && <div className='space-y-2 border-y border-border py-3'><p className='text-sm leading-7'>原资料已更新，当前编辑仍保留。请主动核对最新目标后，再决定是否分配。</p><Button disabled={Boolean(busy)} onClick={() => run('rebase')}>核对最新资料</Button></div>}
      {work.rebase_changes?.length > 0 && <details open><summary className='cursor-pointer text-sm text-brand-600'>本次核对到的最新目标摘要</summary><ul className='mt-3 space-y-3'>{work.rebase_changes.map((item: any, i: number) => <li key={i} className='text-sm leading-7'><strong>{item.current?.title || item.current?.payload?.name || '原资料'}</strong><p className='text-muted'>{item.current?.payload?.summary || item.current?.payload?.logline || item.current?.payload?.identity || '请在原资料编辑入口查看完整内容，再判断是否采用。'}</p></li>)}</ul></details>}
      {work.error && <p role='alert' className='text-sm text-red-700 dark:text-red-300'>{work.error}</p>}
      {work.suggested_cleaned_text && work.suggested_cleaned_text !== work.cleaned_text && <details><summary className='cursor-pointer text-sm text-brand-600'>AI 清理建议与原稿对照（未替换工作稿）</summary><div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'><blockquote className='whitespace-pre-wrap text-sm leading-7 text-muted'>{work.source?.original_text || work.source?.text}</blockquote><p className='whitespace-pre-wrap text-sm leading-7'>{work.suggested_cleaned_text}</p></div><Button className='mt-3 text-xs' disabled={applied} onClick={() => update({ cleaned_text: work.suggested_cleaned_text })}>采用清理建议到工作稿</Button></details>}
      {work.candidates?.length > 0 && <section className='space-y-3 border-y border-border py-4' aria-label='材料骨架预览'><h3 className='font-medium'>这批材料的骨架</h3><ol className='space-y-2'>{work.candidates.filter((row: any) => row.selected !== false).map((row: any, index: number) => <li key={row.id} className='text-sm leading-7'><span className='mr-2 text-muted'>{index + 1}.</span>{KINDS[row.kind] || '资料'}：{row.values?.scene || row.values?.name || row.values?.title || row.label}<p className='text-xs leading-6 text-muted'>{row.values?.plot || row.values?.logline || row.values?.summary || row.values?.identity || ''}</p></li>)}</ol><p className='text-xs text-muted'>下方可修订每项内容并调整次序；确认前只是一份材料工作稿。</p></section>}
      {!applied && <details><summary className='cursor-pointer text-sm text-brand-600'>手动整理一项，不调用模型</summary><div className='mt-3 flex flex-wrap items-end gap-3'><div><label className='mb-1 block text-xs text-muted' htmlFor={`manual-import-kind-${purpose}`}>整理成哪种资料</label><Select id={`manual-import-kind-${purpose}`} value={manualKind} onChange={(e) => setManualKind(e.target.value)}>{['story', 'character', 'world', 'relationship', 'event', 'style'].map((id) => <option key={id} value={id}>{KINDS[id]}</option>)}</Select></div><Button onClick={addManualCandidate}>增加手动候选</Button></div></details>}
      {(work.candidates || []).map((candidate: any, index: number) => <article key={candidate.id} className='space-y-3 border-t border-border pt-4'><div className='flex flex-wrap items-start justify-between gap-2'><label className='flex items-center gap-2 text-sm font-medium'><input type='checkbox' disabled={applied} checked={candidate.selected !== false} onChange={(e) => editCandidate(index, { selected: e.target.checked })} />{candidate.label || KINDS[candidate.kind] || '待确认内容'}</label><span className='text-xs text-muted'>{KINDS[candidate.kind] || '资料'} · {CLASSIFICATION[candidate.classification] || '待判断'}</span></div><details><summary className='cursor-pointer text-xs text-brand-600'>编辑候选内容与原文依据</summary><div className='mt-3 space-y-3'>{editValues(candidate.values || {}, (values) => editCandidate(index, { values }))}{candidate.field_conflicts?.length > 0 && <section className='space-y-3'><h4 className='text-sm font-medium'>与原资料不同的字段</h4>{candidate.field_conflicts.map((item: any, i: number) => <div key={i} className='space-y-2 border-t border-border pt-2'><p className='text-xs font-medium'>{fieldLabel(item.field)}</p><div className='grid grid-cols-1 gap-3 sm:grid-cols-2'><p className='whitespace-pre-wrap text-xs leading-6 text-muted'>原资料：{readable(item.current)}</p><p className='whitespace-pre-wrap text-xs leading-6'>导入候选：{readable(item.incoming)}</p></div></div>)}</section>}{(candidate.evidence || []).map((evidence: any, i: number) => <blockquote key={i} className='text-xs leading-6 text-muted'>{evidence.quote}{evidence.page ? `（第${evidence.page}页）` : ''}</blockquote>)}</div></details><details><summary className='cursor-pointer text-xs text-muted'>这项候选适用的世界与发生时间</summary><div className='mt-3'><WorldContextFields project={project} storyId={work.story_card_id} value={candidate.scope} onChange={(scope) => editCandidate(index, { scope })} inherited='只按材料能支持或作者明确指定的范围采用；未知边界保留未知。' /></div></details><div><label className='mb-1 block text-xs text-muted'>如何分配这项内容</label><Select disabled={applied} value={candidate.decision?.mode || (candidate.classification === 'conflict' ? '' : 'fill')} onChange={(e) => editCandidate(index, { decision: { ...candidate.decision, mode: e.target.value } })}>{candidate.classification === 'conflict' && <option value=''>请先选择如何处理冲突</option>}<option value='fill'>只补原资料空白 / 新增</option><option value='new'>作为独立的新资料新增</option><option value='replace'>用这项候选替换对应字段（需确认）</option><option value='skip'>本次跳过</option></Select>{['fill', 'replace'].includes(candidate.decision?.mode || '') && <Select disabled={applied} className='mt-2' aria-label='候选对应的原资料' value={candidate.decision?.target_id || candidate.target_id || ''} onChange={(e) => editCandidate(index, { decision: { ...candidate.decision, target_id: e.target.value || undefined } })}><option value=''>选择要补充 / 替换的原资料</option>{(Array.isArray(materials) ? materials : []).filter((row: any) => row.type === candidate.kind || candidate.kind === 'relationship' && row.type === 'relationship' || candidate.kind === 'event' && row.type === 'scene').map((row: any) => <option key={row.id} value={row.id}>{row.label || '未命名资料'}</option>)}</Select>}</div><div className='flex gap-2'><Button variant='ghost' className='text-xs' disabled={applied || index === 0} onClick={() => { const rows = [...work.candidates]; [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; update({ candidates: rows }) }}>前移候选</Button><Button variant='ghost' className='text-xs' disabled={applied || index === work.candidates.length - 1} onClick={() => { const rows = [...work.candidates]; [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; update({ candidates: rows }) }}>后移候选</Button></div></article>)}
      {needsStory && <p className='text-xs text-muted'>事件候选需要明确所属故事；请先保存 / 选择故事后新建对应批次。当前候选工作稿仍保留。</p>}{conflictsPending && <p className='text-xs text-muted'>有冲突候选尚未决定处理方式，暂不分配。</p>}{!work.candidates?.length && <p className='text-sm text-muted'>还没有可分配的候选。可以先保存清理稿，或主动提取。</p>}<TokenUsage usage={work.usage} calls={work.usage?.by_module?.length ? undefined : []} />{[...(work.warnings || []), ...(work.source?.warnings || [])].map((warning: string, index: number) => <p key={index} className='text-xs leading-6 text-muted'>{warning}</p>)}<div className='flex flex-wrap gap-2'><Button variant='primary' disabled={Boolean(busy) || applied || needsStory || conflictsPending || !work.candidates?.some((row: any) => row.selected !== false && row.decision?.mode !== 'skip')} onClick={() => run('apply')}>确认分配所选内容</Button><Button disabled={Boolean(busy) || work.status !== 'applied'} onClick={() => run('undo')}>撤销本批应用</Button><Button variant='ghost' disabled={applied || busy === 'create' || busy === 'save'} onClick={() => run('cancel')}>取消本批</Button></div></fieldset>}
    {message && <p role='status' className='text-sm leading-7 text-muted'>{message}</p>}
  </section>
}
