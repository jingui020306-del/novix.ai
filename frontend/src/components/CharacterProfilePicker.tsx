import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { Button } from './ui/Button'
import { Select } from './ui/Fields'

const labels = { identity: '身份', core_motivation: '动机', vulnerability: '软肋', personality_traits: '性格', voice: '说话习惯' }
type Field = keyof typeof labels
type Mode = 'draw' | 'lock' | 'blank'
type FieldValues = Partial<Record<Field, string | string[]>>
const fields = Object.keys(labels) as Field[]
const display = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join('、') : value || '')

export function CharacterProfilePicker({
  project,
  card,
  storyId,
  worldContext,
  lockedPaths = [],
  onChange,
}: {
  project: string
  card: any
  storyId?: string
  worldContext?: any
  lockedPaths?: string[]
  onChange: (card: any) => void
}) {
  const payload = card.payload || {}
  const history = payload.profile_generation || {}
  const isProtected = (field: Field) =>
    lockedPaths.some((path) => ['/', '/payload', '/payload/' + field].includes(path) || path.startsWith('/payload/' + field + '/')) ||
    (field === 'personality_traits' && [...(payload.family_locked || []), ...(payload.family_blank || [])].includes('trait'))
  const settingsLocked = lockedPaths.some(
    (path) => ['/', '/payload', '/payload/profile_generation'].includes(path) || path.startsWith('/payload/profile_generation/'),
  )
  const [modes, setModes] = useState<Record<Field, Mode>>(
    () =>
      Object.fromEntries(
        fields.map((field) => [
          field,
          history.blank?.includes(field)
            ? 'blank'
            : (history.locked ? history.locked.includes(field) : display(payload[field]))
              ? 'lock'
              : 'draw',
        ]),
      ) as Record<Field, Mode>,
  )
  const [seed, setSeed] = useState<string | undefined>(history.seed)
  const [counts, setCounts] = useState<Partial<Record<Field, number>>>(history.counts || {})
  const [values, setValues] = useState<FieldValues>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const baseline = useRef<FieldValues>({})
  const latest = useRef(card)
  latest.current = card
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [card.id, project],
  )

  const draw = async (one?: Field) => {
    const selected = (one ? [one] : fields).filter((f) => !isProtected(f) && modes[f] === 'draw')
    if (!selected.length) return
    const turn = ++request.current
    const before = JSON.stringify(latest.current)
    const nextCounts = { ...counts }
    for (const f of selected) if (seed !== undefined) nextCounts[f] = (nextCounts[f] || 0) + 1
    setBusy(true)
    setMessage('')
    try {
      const result = await api.post(`/api/projects/${encodeURIComponent(project)}/family/profile`, {
        center_id: card.id,
        story_card_id: storyId,
        world_context: worldContext || payload.world_context,
        seed,
        counts: nextCounts,
        fields: selected,
        locked: fields.filter((f) => isProtected(f) || modes[f] === 'lock'),
        blank: fields.filter((f) => modes[f] === 'blank'),
      })
      if (turn !== request.current) return
      if (JSON.stringify(latest.current) !== before) throw new Error('人物资料已修改，请重新生成候选。')
      for (const f of selected) baseline.current[f] = payload[f]
      setValues((old) => {
        const next = { ...old }
        for (const f of selected) delete next[f]
        return { ...next, ...result.values }
      })
      setSeed(result.seed)
      setCounts(result.counts)
    } catch (error) {
      if (turn === request.current) setMessage(error instanceof Error ? error.message : '候选生成失败。')
    } finally {
      if (turn === request.current) setBusy(false)
    }
  }

  const adopt = () => {
    const next = { ...payload }
    const changed: string[] = []
    for (const f of fields) {
      if (isProtected(f) || modes[f] === 'lock') continue
      if (modes[f] === 'blank') {
        next[f] = f === 'personality_traits' ? [] : ''
      } else if (values[f] !== undefined) {
        if (JSON.stringify(payload[f]) !== JSON.stringify(baseline.current[f])) {
          setMessage(`「${labels[f]}」已手动修改。锁定该项或重新生成后再采用。`)
          return
        }
        next[f] = values[f]
      }
      if (JSON.stringify(payload[f]) !== JSON.stringify(next[f])) changed.push(f)
    }
    next.profile_generation = {
      seed,
      counts,
      locked: fields.filter((f) => modes[f] === 'lock'),
      blank: fields.filter((f) => modes[f] === 'blank'),
    }
    if (changed.length)
      next.field_provenance = {
        ...next.field_provenance,
        ...Object.fromEntries(changed.map((f) => [f, 'author_edit'])),
      }
    onChange({ ...card, payload: next })
    setValues({})
    setMessage('已填入人物草稿，可继续修改后保存。')
  }

  return (
    <details className="mb-4">
      <summary className="cursor-pointer text-sm font-medium">随机人物设定</summary>
      <fieldset disabled={busy || settingsLocked} className="mt-3 space-y-2">
        {fields.map((f) => (
          <div key={f} className="grid items-center gap-2 sm:grid-cols-[5rem_1fr_6rem_auto]">
            <span className="text-sm">{labels[f]}</span>
            <span className="text-sm text-muted">
              {modes[f] === 'blank' && !isProtected(f)
                ? '留白'
                : display(!isProtected(f) && modes[f] === 'draw' ? (values[f] ?? payload[f]) : payload[f]) || '—'}
            </span>
            <Select
              aria-label={labels[f] + '生成方式'}
              value={isProtected(f) ? 'lock' : modes[f]}
              disabled={isProtected(f)}
              onChange={(e) => {
                setModes({ ...modes, [f]: e.target.value as Mode })
                setMessage('')
              }}
            >
              <option value="draw">可生成</option>
              <option value="lock">锁定</option>
              <option value="blank">留白</option>
            </Select>
            <Button
              type="button"
              disabled={isProtected(f) || modes[f] !== 'draw'}
              aria-label={'重抽' + labels[f]}
              onClick={() => draw(f)}
            >
              重抽
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button type="button" disabled={!fields.some((f) => !isProtected(f) && modes[f] === 'draw')} onClick={() => draw()}>
            生成一组
          </Button>
          <Button type="button" onClick={adopt}>
            采用到草稿
          </Button>
        </div>
      </fieldset>
      {message && (
        <p role="status" className="mt-2 text-xs text-muted">
          {message}
        </p>
      )}
    </details>
  )
}
