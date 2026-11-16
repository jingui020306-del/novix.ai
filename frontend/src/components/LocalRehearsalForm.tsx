import { useEffect, useRef, useState } from 'react'
import { Input, Select } from './ui/Fields'
import { ChoiceStakes, CastParticipant, CastSimulation, LocalChoices, LocalSimulation, PairSimulation } from '../lib/sceneRehearsal'

type Engine = PairSimulation['engines'][number]
type Options = { cast: string[]; presets: Record<string, LocalChoices>; engines: Record<Engine, boolean> }
type Person = { id: string; label: string; payload?: { name?: string } }
const choiceLabels: Record<keyof LocalChoices, string> = {
  act: '主动行动', hold: '保留选择', effect: '对方能观察到的后果', respond: '对方主动回应', check: '对方审慎回应',
}
const engineLabels: Record<Engine, string> = {
  praxish: 'Praxish · 情境允许的行动', sabre: 'Sabre · 通往指定结果的路径', fatima: 'FAtiMA · 对方对事件的情绪评价',
}
type FormProps = {
  options: Options; people: Person[]; initial: LocalSimulation; busy: boolean;
  onChange: (spec: LocalSimulation | null) => void;
}

function StakesFields({value = {}, onChange}: {value?: ChoiceStakes; onChange: (value: ChoiceStakes) => void}) {
  return <details className='sm:col-span-2'><summary className='cursor-pointer text-muted'>这次行动的取舍</summary>
    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
      <label>对当前目标<Select aria-label="对当前目标" value={value.goal_fit ?? 0} onChange={e => onChange({...value, goal_fit: Number(e.target.value)})}>
        <option value={0}>尚未确定</option><option value={1}>有利</option><option value={-1}>背离</option>
      </Select></label>
      <label>对本次互动的立场<Select aria-label="对本次互动的立场" value={value.stance ?? 0} onChange={e => onChange({...value, stance: Number(e.target.value)})}>
        <option value={0}>中立或未知</option><option value={1}>愿意配合</option><option value={-1}>倾向抵触</option>
      </Select></label>
      <label><input type='checkbox' checked={value.exposes_weakness ?? false} onChange={e => onChange({...value, exposes_weakness:e.target.checked})}/> 此举会暴露自己的软肋</label>
    </div>
  </details>
}

export function LocalRehearsalForm(props: FormProps) {
  const {initial} = props
  return 'participants' in initial
    ? <CastForm {...props} initial={initial} />
    : <PairForm {...props} initial={initial} />
}

function CastForm({initial, people, busy, onChange}: FormProps & {initial: CastSimulation}) {
  const [form, setForm] = useState(initial)
  const dirty = useRef(false)
  useEffect(() => { if (!dirty.current) setForm(initial) }, [initial])
  const fields = {goal: '目标', act: '主动行动', hold: '保留选择', effect: '可见后果'}
  const nameOf = (id: string) => {
    const person = people.find(p => p.id === id)
    return person?.payload?.name || person?.label || '场内人物'
  }
  function change(next: CastSimulation) {
    dirty.current = true
    setForm(next)
    onChange(next)
  }
  function editMember(index: number, patch: Partial<CastParticipant>) {
    change({...form, participants: form.participants.map((person, i) => i === index ? {...person, ...patch} : person)})
  }
  function changeOrder(index: number, target: number) {
    const members = [...form.participants]
    const [person] = members.splice(index, 1)
    members.splice(target, 0, person)
    change({...form, participants: members})
  }
  return <details className='py-3'>
    <summary className='cursor-pointer font-medium'>调整本场排演假设</summary>
    <fieldset disabled={busy} className='mt-4 space-y-4 text-sm'>
      <label className='block'>场景中的事项<Input value={form.topic || ''} maxLength={120} onChange={e => change({...form, topic:e.target.value})}/></label>
      {form.participants.map((person, index) => {
        const name = nameOf(person.actor_id)
        const audience = person.visible_to
        const audienceLabel = audience == null ? '全场' : audience.length ? audience.map(nameOf).join('、') : '仅本人'
        return <details key={person.actor_id} open={form.mode === 'solo' || undefined}>
          <summary className='cursor-pointer text-sm font-medium'>{form.mode === 'ensemble' && `${index + 1}. `}{name}</summary>
          <div className='mt-3 grid gap-3 sm:grid-cols-2'>
            {form.mode === 'ensemble' && <label className='block'>行动顺序<Select aria-label={`${name}的行动顺序`} value={index} onChange={e => changeOrder(index, Number(e.target.value))}>
              {form.participants.map((p,i) => <option key={p.actor_id} value={i}>第 {i + 1} 位</option>)}
            </Select></label>}
            {(Object.keys(fields) as (keyof typeof fields)[]).map(key => <label key={key} className='block'>{fields[key]}
              <Input aria-label={`${name}的${fields[key]}`} value={person[key] || ''} maxLength={120} onChange={e => editMember(index, {[key]:e.target.value})}/>
            </label>)}
            {form.mode === 'ensemble' && <details className='sm:col-span-2'>
              <summary className='cursor-pointer text-muted'>后果可见范围 · {audienceLabel}</summary>
              <div className='mt-2 flex flex-wrap gap-3' role='group' aria-label={`${name}的后果可见范围`}>
                <label><input type='radio' name={`audience-${person.actor_id}`} checked={audience == null} onChange={() => editMember(index, {visible_to:null})}/> 全场可见</label>
                <label><input type='radio' name={`audience-${person.actor_id}`} checked={Array.isArray(audience) && !audience.length} onChange={() => editMember(index, {visible_to:[]})}/> 仅本人</label>
                {form.participants.filter(other => other.actor_id !== person.actor_id).map(other => <label key={other.actor_id}>
                  <input type='checkbox' aria-label={`${name}的后果对${nameOf(other.actor_id)}可见`} checked={audience?.includes(other.actor_id) ?? false}
                    onChange={e => editMember(index,{visible_to:e.target.checked?[...(audience || []),other.actor_id]:(audience || []).filter(id => id !== other.actor_id)})}/> {nameOf(other.actor_id)}
                </label>)}
              </div>
            </details>}
            <StakesFields value={person.stakes} onChange={stakes => editMember(index, {stakes})}/>
            <label className='block'>行动把握 {Math.round((person.confidence ?? .7) * 100)}%
              <input type='range' className='w-full' min={0} max={100} value={Math.round((person.confidence ?? .7) * 100)} onChange={e => editMember(index,{confidence:Number(e.target.value)/100})}/></label>
            <label className='block'>失败代价<Select value={person.loss ?? 5} onChange={e => editMember(index, {loss:Number(e.target.value)})}>
              <option value={2}>较小</option><option value={5}>中等</option><option value={8}>较大</option>
            </Select></label>
            <label><input type='checkbox' checked={person.available !== false} onChange={e => editMember(index, {available:e.target.checked})}/> 具备主动行动的前提</label>
          </div>
        </details>
      })}
    </fieldset>
  </details>
}

function PairForm({ options, people, initial, busy, onChange }: FormProps & {initial: PairSimulation}) {
  const cast = people.filter(p => options.cast.includes(p.id))
  const presets = Object.keys(options.presets)
  const [form, setForm] = useState(initial)
  const dirty = useRef(false)
  useEffect(() => { if (!dirty.current) setForm(initial) }, [initial])
  function change(patch: Partial<PairSimulation>) {
    dirty.current = true
    const next = { ...form, ...patch }
    setForm(next)
    const valid = next.actor_id !== next.partner_id && [next.actor_id, next.partner_id].every(id => cast.some(p => p.id === id))
      && next.topic.trim() && Object.values(next.choices).every(v => v.trim())
      && next.choices.act !== next.choices.hold && next.choices.respond !== next.choices.check
      && next.engines.every(k => options.engines[k])
    onChange(valid ? next : null)
  }
  const selected = (key: Engine) => form.engines.includes(key)
  const idsValid = [form.actor_id, form.partner_id].every(id => cast.some(p => p.id === id)) && form.actor_id !== form.partner_id
  return <details className='border-y border-border py-4'>
    <summary className='cursor-pointer font-medium'>调整本场排演假设</summary>
    {cast.length < 2 ? <p className='mt-3 text-sm text-muted'>请先在本场情节关联两位人物，再打开排演。</p> :
    <fieldset disabled={busy} className='mt-4 space-y-4 text-sm'>
      <label className='block'>场景中的事项<Input className='w-full' value={form.topic} maxLength={120} onChange={e => change({ topic: e.target.value })} /></label>
      <div className='grid gap-3 sm:grid-cols-2'>{(['actor', 'partner'] as const).map((role) =>
        <div className='space-y-2' key={role}><label className='block'>{role === 'actor' ? '先行动的人' : '回应的人'}
          <Select className='w-full' value={form[role === 'actor' ? 'actor_id' : 'partner_id']} onChange={e => change(role === 'actor' ? { actor_id: e.target.value } : { partner_id: e.target.value })}>
            {cast.map(p => <option key={p.id} value={p.id}>{p.payload?.name || p.label}</option>)}</Select></label>
          <label className='block'>行动能达到预期的主观把握 {Math.round(100 * form[`${role}_confidence`])}%
            <input type='range' className='w-full' min={0} max={100} value={Math.round(100 * form[`${role}_confidence`])} onChange={e => change({ [`${role}_confidence`]: Number(e.target.value) / 100 })} /></label>
          <StakesFields value={form[`${role}_stakes`]} onChange={stakes => change({[`${role}_stakes`]: stakes})}/>
          <label className='block'>这个人承担的失败代价<Select className='w-full' value={form[`${role}_loss`]} onChange={e => change({ [`${role}_loss`]: Number(e.target.value) })}>
            <option value={2}>较小</option><option value={5}>中等</option><option value={8}>较大</option></Select></label>
        </div>)}</div>
      <label className='block'>套用情境动作<Select className='w-full' value={presets.find(k => JSON.stringify(options.presets[k]) === JSON.stringify(form.choices)) || ''} onChange={e => change({ choices: { ...options.presets[e.target.value] } })}>
        <option disabled value=''>自定义动作</option>{presets.map(k => <option key={k}>{k}</option>)}</Select></label>
      <details><summary className='cursor-pointer'>编辑候选动作与后果</summary><div className='mt-2 grid gap-2 sm:grid-cols-2'>{(Object.keys(choiceLabels) as (keyof LocalChoices)[]).map(k => <label key={k}>{choiceLabels[k]}<Input className='w-full' maxLength={120} value={form.choices[k]} onChange={e => change({ choices: { ...form.choices, [k]: e.target.value } })} /></label>)}</div></details>
      <label className='block'><input type='checkbox' checked={form.available} onChange={e => change({ available: e.target.checked })} /> 本场具备“{form.choices.act}”的前提</label>
      <div className='space-y-1'>{(Object.keys(engineLabels) as Engine[]).map(k => <label key={k} className='block'><input type='checkbox' disabled={!options.engines[k] && !selected(k)} checked={selected(k)} onChange={e => change({ engines: e.target.checked ? [...form.engines, k] : form.engines.filter(v => v !== k) })} /> {engineLabels[k]}{!options.engines[k] && '（后端未就绪）'}</label>)}</div>
      {selected('fatima') && <label className='block'>对方如何看待这个后果（−10 不利，+10 有利）：{form.desirability}
        <input className='w-full' type='range' min={-10} max={10} value={form.desirability} onChange={e => change({ desirability: Number(e.target.value) })} /></label>}
      {selected('sabre') && <label className='block'>希望比较的路径终点<Select className='w-full' value={form.plan_goal} onChange={e => change({ plan_goal: e.target.value as PairSimulation['plan_goal'] })}>
        <option value='respond'>{form.choices.respond}</option><option value='check'>{form.choices.check}</option></Select></label>}
      {Object.values(options.engines).some(v => !v) && <details><summary className='cursor-pointer'>安装本地引擎</summary><p>后端主机使用 Node 20、Java 21 或更高版本、.NET 8 SDK 和 Git。在项目根目录运行 <code>python backend/rehearsal_engines/install.py</code>，完成后刷新页面。</p></details>}
      {!idsValid && <p role='status'>请选择两位不同的本场人物。</p>}
    </fieldset>}
  </details>
}
