import { useRef, useState } from 'react'
import { CharacterPortrait } from './CharacterPortrait'
import { api } from '../api/client'
import { pointerLocked } from './AuthorControls'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Fields'

const labels = {
  experience: '成长经历', expectation: '当时的预期', core_motivation: '动机',
  response: '应对方式', feedback: '得到的反馈', personality_traits: '性格倾向',
}
type Field = keyof typeof labels
type Candidate = Partial<Record<Field | 'situation', string>>
type Proposal = { candidates: Candidate[]; notices: string[]; specialists: Record<string, string[]> }
const fields = Object.keys(labels) as Field[]
const cardFields: Partial<Record<Field, string>> = { experience: 'family_background', core_motivation: 'core_motivation', personality_traits: 'personality_traits' }
const sectionId = (field: Field) => 'formation_' + field

export function CharacterFormation({ project, card, storyId, lockedPaths, onChange }: {
  project: string; card: any; storyId?: string; lockedPaths: string[]; onChange: (card: any) => void
}) {
  const [observation, setObservation] = useState('')
  const [selected, setSelected] = useState<Field[]>([])
  const [compare, setCompare] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const original = useRef<Candidate[]>([])
  const [index, setIndex] = useState(0)
  const [kept, setKept] = useState<Field[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const payload = card.payload || {}
  const sections = payload.detail_sections || []
  const unavailable = (field: Field) => {
    const key = cardFields[field]
    if (key) {
      return Boolean(payload[key]?.length || pointerLocked(lockedPaths, '/payload/' + key, true)
        || payload.profile_generation?.blank?.includes(key) || payload.profile_generation?.locked?.includes(key)
        || field === 'personality_traits' && [...(payload.family_locked || []), ...(payload.family_blank || [])].includes('trait'))
    }
    return sections.some((s: any) => s.id === sectionId(field)) ||
      pointerLocked(lockedPaths, '/payload/detail_sections/@' + sectionId(field), true)
  }
  const requested = fields.filter(f => selected.includes(f) && !unavailable(f))
  const signature = JSON.stringify([project, card, storyId, lockedPaths, observation, requested, compare])
  const current = useRef(signature)
  current.current = signature
  const baseline = useRef('')
  const active = proposal && baseline.current === signature ? proposal : null
  const candidate = active?.candidates[index]

  async function generate() {
    const before = signature
    setBusy(true); setMessage(''); setProposal(null)
    try {
      const result = await api.post(`/api/projects/${encodeURIComponent(project)}/cards/character-formation`, {
        card, story_card_id: storyId, fields: requested, observation, compare_glucose: compare,
      })
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '请检查所选空项。')
      if (before !== current.current) throw new Error('依据已修改，请重新生成。')
      baseline.current = before
      original.current = result.candidates
      setProposal(result); setIndex(0); setKept(requested)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '候选生成失败。')
    } finally { setBusy(false) }
  }

  function edit(key: keyof Candidate, value: string) {
    if (active) setProposal({ ...active, candidates: active.candidates.map((row, i) => i === index ? { ...row, [key]: value } : row) })
  }

  function adopt() {
    if (!candidate || baseline.current !== current.current) return
    const next = { ...payload, field_provenance: { ...payload.field_provenance } }
    const added = []
    for (const field of kept) {
      const value = candidate[field]?.trim()
      if (!value || unavailable(field)) continue
      const source = value === original.current[index]?.[field]?.trim() ? 'ai_addition' : 'author_edit'
      const key = cardFields[field]
      if (key) {
        next[key] = field === 'personality_traits' ? [value] : value
        next.field_provenance[key] = source
      } else {
        added.push({ id: sectionId(field), title: labels[field], content: value, usage: 'relevant',
          ...(field === 'response' ? { situation: candidate.situation?.trim() || '' } : {}),
          sources: [{ kind: source, label: '作者采用的性格来由候选' }] })
      }
    }
    if (added.length) {
      next.detail_sections = [...sections, ...added]
      next.field_provenance.detail_sections = 'author_edit'
    }
    onChange({ ...card, payload: next })
    setProposal(null); setSelected([]); setMessage('已填入草稿，可继续修改后保存人物。')
  }

  return <><details className="py-2">
    <summary className="cursor-pointer text-sm font-medium">补写性格来由</summary>
    <div className="mt-3 space-y-3">
      <Textarea aria-label="已有性格、经历或行为" value={observation} maxLength={2000}
        placeholder="补充一条性格、经历或具体行为，也可直接使用已填的人物卡。" onChange={e => setObservation(e.target.value)} />
      <fieldset><legend className="mb-2 text-sm">只补所选空项</legend>
        <div className="flex flex-wrap gap-3">{fields.map(f => <label key={f} className="flex gap-1 text-sm">
          <input type="checkbox" disabled={unavailable(f)} checked={requested.includes(f)}
            onChange={e => setSelected(e.target.checked ? [...selected, f] : selected.filter(k => k !== f))} />{labels[f]}
        </label>)}</div>
      </fieldset>
      <label className="flex gap-2 text-xs text-muted"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />对照 GLUCOSE 事件解释</label>
      <Button disabled={busy || !requested.length} onClick={generate}>{busy ? '生成中…' : '生成候选'}</Button>
      {active && candidate && <div className="space-y-2">
        <div className="flex gap-2">{active.candidates.map((_, i) => <Button key={i} aria-pressed={i === index}
          variant={i === index ? 'primary' : 'ghost'} onClick={() => setIndex(i)}>方案 {i + 1}</Button>)}</div>
        {requested.map(f => <div key={f}><label className="flex gap-2 text-sm">
          <input type="checkbox" checked={kept.includes(f)} onChange={e => setKept(e.target.checked ? [...kept, f] : kept.filter(k => k !== f))} />采用{labels[f]}
        </label><Textarea aria-label={'候选' + labels[f]} value={candidate[f] || ''} onChange={e => edit(f, e.target.value)} />
        {f === 'response' && <Input aria-label="应对方式适用的处境" placeholder="在哪种处境下适用" value={candidate.situation || ''} onChange={e => edit('situation', e.target.value)} />}</div>)}
        <Button disabled={!kept.some(f => candidate[f]?.trim())} onClick={adopt}>采用到人物草稿</Button>
        {(active.notices.length > 0 || Object.keys(active.specialists).length > 0) && <details>
          <summary className="cursor-pointer text-xs text-muted">模型与对照结果</summary>
          {Object.entries(active.specialists).map(([name, rows]) => <p key={name} className="text-sm">{name.toUpperCase()} · {rows.join(' / ')}</p>)}
          {active.notices.map(note => <p key={note} className="text-xs text-muted">{note}</p>)}
        </details>}
      </div>}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
  </details><CharacterPortrait key={project + card.id} {...{ project, card, storyId, lockedPaths, onChange }} /></>
}
