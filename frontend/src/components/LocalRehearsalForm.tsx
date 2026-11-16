import { useState } from 'react'
import { Input, Select } from './ui/Fields'
import { Button } from './ui/Button'
import { LocalChoices, LocalSimulation } from '../lib/sceneRehearsal'

type Engine = LocalSimulation['engines'][number]
type Options = { cast: string[]; presets: Record<string, LocalChoices>; engines: Record<Engine, boolean> }
type Person = { id: string; label: string; payload?: { name?: string } }
const choiceLabels: Record<keyof LocalChoices, string> = {
  act: '主动行动', hold: '保留选择', effect: '对方能观察到的后果', respond: '对方主动回应', check: '对方审慎回应',
}
const engineLabels: Record<Engine, string> = {
  praxish: 'Praxish · 情境允许的行动', sabre: 'Sabre · 通往指定结果的路径', fatima: 'FAtiMA · 对方对事件的情绪评价',
}
export function LocalRehearsalForm({ options, people, saved, busy, topic, run, onChange }: {
  options: Options; people: Person[]; saved?: LocalSimulation; busy: boolean; topic: string;
  run: (spec: LocalSimulation) => void; onChange: () => void;
}) {
  const cast = people.filter(p => options.cast.includes(p.id))
  const presets = Object.keys(options.presets)
  const [form, setForm] = useState<LocalSimulation>(() => saved || {
    version: 1, actor_id: cast[0]?.id || '', partner_id: cast[1]?.id || '', topic: topic.slice(0, 120),
    available: true, actor_confidence: 0.7, partner_confidence: 0.7, actor_loss: 5, partner_loss: 5,
    choices: options.presets[presets[0]], plan_goal: 'respond', desirability: 0,
    engines: (Object.keys(engineLabels) as Engine[]).filter(key => options.engines[key]),
  })
  function change(patch: Partial<LocalSimulation>) { setForm(old => ({ ...old, ...patch })); onChange() }
  const selected = (key: Engine) => form.engines.includes(key)
  const idsValid = [form.actor_id, form.partner_id].every(id => cast.some(p => p.id === id)) && form.actor_id !== form.partner_id
  return <details className='border-y border-border py-4' open>
    <summary className='cursor-pointer font-medium'>本地人物排演</summary>
    {cast.length < 2 ? <p className='mt-3 text-sm text-muted'>请先在本场情节关联两位人物，再打开排演。</p> :
    <fieldset disabled={busy} className='mt-4 space-y-4 text-sm'>
      <label className='block'>场景中的事项<Input className='w-full' value={form.topic} maxLength={120} onChange={e => change({ topic: e.target.value })} /></label>
      <div className='grid gap-3 sm:grid-cols-2'>{(['actor', 'partner'] as const).map((role) =>
        <div className='space-y-2' key={role}><label className='block'>{role === 'actor' ? '先行动的人' : '回应的人'}
          <Select className='w-full' value={form[role === 'actor' ? 'actor_id' : 'partner_id']} onChange={e => change(role === 'actor' ? { actor_id: e.target.value } : { partner_id: e.target.value })}>
            {cast.map(p => <option key={p.id} value={p.id}>{p.payload?.name || p.label}</option>)}</Select></label>
          <label className='block'>行动能达到预期的主观把握 {Math.round(100 * form[`${role}_confidence`])}%
            <input type='range' className='w-full' min={0} max={100} value={Math.round(100 * form[`${role}_confidence`])} onChange={e => change({ [`${role}_confidence`]: Number(e.target.value) / 100 })} /></label>
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
      {selected('sabre') && <label className='block'>希望比较的路径终点<Select className='w-full' value={form.plan_goal} onChange={e => change({ plan_goal: e.target.value as LocalSimulation['plan_goal'] })}>
        <option value='respond'>{form.choices.respond}</option><option value='check'>{form.choices.check}</option></Select></label>}
      {Object.values(options.engines).some(v => !v) && <details><summary className='cursor-pointer'>安装本地引擎</summary><p>后端主机使用 Node 20、Java 21 或更高版本、.NET 8 SDK 和 Git。在项目根目录运行 <code>python backend/rehearsal_engines/install.py</code>，完成后刷新页面。</p></details>}
      {!idsValid && <p role='status'>请选择两位不同的本场人物。</p>}
      <Button type='button' disabled={!idsValid || !form.topic.trim() || Object.values(form.choices).some(v => !v.trim()) || form.engines.some(k => !options.engines[k])} onClick={() => run(form)}>按人物选择排演</Button>
    </fieldset>}
  </details>
}
