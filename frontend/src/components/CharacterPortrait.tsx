import { type ReactNode, useRef, useState } from 'react'
import { api } from '../api/client'
import { pointerLocked } from './AuthorControls'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Fields'

const layers = { personal: '个人自我', social: '社会自我', core: '核心自我', extended: '衍生自我', protected: '保护自我', fading: '消失自我', hidden: '隐藏自我' }
type Layer = keyof typeof layers
type Evidence = { source_id: string; label: string; quote: string; chiron_claims?: string[] }
type Candidate = { section_id: string; layer: Layer; content: string; situation: string; response: string; sources: Evidence[]; desirability?: number }
type Props = { project: string; card: any; storyId?: string; lockedPaths: string[]; profileId: string; modelPicker: ReactNode; onChange: (card: any) => void }

export function CharacterPortrait({ project, card, storyId, lockedPaths, profileId, modelPicker, onChange }: Props) {
  const [verify, setVerify] = useState(false)
  const [selected, setSelected] = useState<Layer[]>(['personal'])
  const [material, setMaterial] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [failed, setFailed] = useState<Layer[]>([])
  const [empty, setEmpty] = useState<Layer[]>([])
  const [kept, setKept] = useState<Layer[]>([])
  const scope = useRef({})
  const generation = useRef('')
  const locked = (key: Layer) => pointerLocked(lockedPaths, '/payload/detail_sections/@self_' + key, true)
  const fields = selected.filter(key => !locked(key))
  const signature = JSON.stringify([project, storyId, card, fields, material, verify, profileId, lockedPaths])
  const current = useRef(signature)
  current.current = signature
  const fresh = generation.current === signature
  const visible = fresh ? candidates : []
  const sections = card.payload.detail_sections || []

  async function generate(retry = false) {
    const before = signature
    const requested = retry ? failed : fields
    setBusy(true); setNote('')
    if (!retry) {
      setCandidates([]); setFailed([]); setEmpty([]); setKept([])
    }
    try {
      const answer = await api.post('/api/projects/' + encodeURIComponent(project) + '/cards/character-portrait',
        { card, story_card_id: storyId, fields: requested, material, mode: verify ? 'chiron' : 'direct', llm_profile_id: profileId })
      if (answer.detail) throw new Error(typeof answer.detail === 'string' ? answer.detail : '请核对本次材料。')
      if (before !== current.current) return
      generation.current = before
      scope.current = answer.scope || {}
      const received = answer.candidates.map((row: Candidate) => ({ ...row,
        desirability: sections.find((s: any) => s.id === row.section_id)?.desirability }))
      setCandidates(rows => [...(retry ? rows : []), ...received].sort((a, b) => fields.indexOf(a.layer) - fields.indexOf(b.layer)))
      setKept(previous => [...(retry ? previous : []), ...received.map((row: Candidate) => row.layer)])
      setEmpty(previous => [...(retry ? previous : []), ...answer.empty])
      setFailed(answer.failed)
    } catch (e) { if (before === current.current) setNote(e instanceof Error ? e.message : '分析失败。') }
    finally { setBusy(false) }
  }

  function adopt() {
    const updated = [...sections]
    for (const row of visible.filter(row => kept.includes(row.layer) && row.content.trim() && !locked(row.layer))) {
      const id = row.section_id
      const i = updated.findIndex(s => s.id === id)
      const previous = i < 0 ? {} : updated[i]
      const section = { ...previous, id, title: previous.title || layers[row.layer], content: row.content.trim(),
        scope: previous.scope || scope.current,
        usage: previous.usage || (row.layer === 'hidden' ? 'author_only' : 'relevant'),
        situation: row.situation.trim(), response: row.response.trim(),
        sources: [...(previous.sources || []).filter((s: any) => s?.kind !== 'portrait_evidence'), ...row.sources] }
      if (row.desirability != null) section.desirability = row.desirability
      else delete section.desirability
      if (i === -1) updated.push(section)
      else updated[i] = section
    }
    onChange({ ...card, payload: { ...card.payload, detail_sections: updated } })
    setCandidates([]); setNote('已填入人物草稿。保存人物后生效。')
  }
  function edit(layer: Layer, patch: Partial<Candidate>) {
    setCandidates(rows => rows.map(row => row.layer === layer ? { ...row, ...patch } : row))
  }

  const choice = (key: Layer) => <label key={key} className="flex gap-1 text-sm"><input type="checkbox"
    disabled={locked(key)} checked={fields.includes(key)} onChange={e => setSelected(e.target.checked ?
      [...selected, key] : selected.filter(s => s !== key))} />{layers[key]}{locked(key) ? '（已锁定）' : ''}</label>

  return <details className="py-2"><summary className="cursor-pointer text-sm font-medium">从原文分析四重自我</summary>
    <div className="mt-3 space-y-3">
      <Textarea aria-label="人物原文" maxLength={12000} value={material} onChange={e => setMaterial(e.target.value)}
        placeholder="可贴多段原文，每段一行。已填的成长经历和社会关系也会作为依据。" />
      <fieldset><legend className="mb-2 text-sm">本次分析</legend><div className="flex flex-wrap gap-3">
        {(['personal', 'social', 'core', 'hidden'] as Layer[]).map(choice)}</div>
        <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">细分核心自我</summary>
          <div className="mt-2 flex flex-wrap gap-3">{(['extended', 'protected', 'fading'] as Layer[]).map(choice)}</div></details>
      </fieldset>
      {modelPicker}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={verify}
        onChange={e => setVerify(e.target.checked)} />使用 CHIRON 核验原文</label>
      <Button disabled={busy || !fields.length} onClick={() => generate()}>{busy ? '分析中…' : '生成所选部分'}</Button>
      {fresh && empty.length > 0 && <p className="text-sm text-muted">依据不足，暂留空：{empty.map(key => layers[key]).join('、')}</p>}
      {fresh && failed.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>未生成：{failed.map(key => layers[key]).join('、')}</span>
        <Button disabled={busy} onClick={() => generate(true)}>重试未生成部分</Button>
      </div>}
      {visible.map(row => <fieldset key={row.layer} className="space-y-2">
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={kept.includes(row.layer)} onChange={e =>
          setKept(e.target.checked ? [...kept, row.layer] : kept.filter(k => k !== row.layer))} />采用{layers[row.layer]}</label>
        <Textarea aria-label={layers[row.layer] + '候选'} value={row.content} onChange={e => edit(row.layer, { content: e.target.value })} />
        <details><summary className="cursor-pointer text-xs text-muted">原文依据（{row.sources.length}）</summary>
          {row.sources.map((s, i) => <blockquote key={i} className="mt-2 text-sm"><strong>{s.label}</strong><p>{s.quote}</p>
            {s.chiron_claims?.map(line => <p key={line} className="text-xs text-muted">{line}</p>)}</blockquote>)}</details>
        <details><summary className="cursor-pointer text-xs text-muted">排演时怎样使用</summary>
          <Input aria-label="适用处境" placeholder="适用处境" value={row.situation} onChange={e => edit(row.layer, { situation: e.target.value })} />
          <Input aria-label="可见行动" placeholder="人物可能采取的行动" value={row.response} onChange={e => edit(row.layer, { response: e.target.value })} />
          <label className="text-xs">事件对人物目标的影响（−10 最不利，10 最有利，可留空）<Input type="number" min={-10} max={10} step={1}
            value={row.desirability ?? ''} onChange={e => { const n = e.target.valueAsNumber
              if (!e.target.value || Number.isInteger(n) && Math.abs(n) <= 10) edit(row.layer, { desirability: e.target.value ? n : undefined })
            }} /></label></details>
      </fieldset>)}
      {!!visible.length && <Button disabled={busy || !visible.some(row => kept.includes(row.layer) && row.content.trim())} onClick={adopt}>采用到人物草稿</Button>}
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
    </div></details>
}
