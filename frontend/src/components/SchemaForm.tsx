import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'
import { WritingReferenceNotice, WritingReferencePicker } from './WritingReferencePicker'
import { MaterialReferences, OpenMaterial } from './MaterialReferences'

const LABELS: Record<string, string> = {
  detail_level: '人物资料深度', initial_age: '初始年龄', initial_age_time: '初始年龄对应时间', birth_date: '出生日期', initial_pov: '默认人物视角', world_context: '世界与发生时间', year: '年份',
  title: '名称', tags: '标签', name: '姓名', identity: '身份', appearance: '基础外貌',
  core_motivation: '最想得到什么', personality_traits: '性格', family_background: '成长经历',
  voice: '表达习惯', boundaries: '不能突破的底线', relationships: '人物关系', arc: '成长变化',
  target: '关联人物', type: '关系', beat: '发生在何处', goal: '目标', role: '人物角色',
  importance: '重要程度', age: '年龄', description: '说明', aliases: '别称',
  gender: '性别 / 自定义分类', pronouns: '叙述代词', address_notes: '本人物的称呼说明', address_as: '此人怎样称呼对方',
  category_id: '所属分类', parent_id: '上级分类', sort_order: '排列顺序', core_techniques: '主要技法',
  apply_steps: '怎么使用', signals: '正文中的表现', intensity_levels: '使用程度',
  low: '轻度', med: '适中', high: '突出', metrics: '写作偏好', dialogue_ratio_range: '对话比例',
  punctuation_caps: '标点使用上限', metaphor_density: '比喻使用程度',
  do_dont: '使用建议', do: '建议这样写', dont: '避免这样写', examples: '例子',
  category: '用途', input_types: '参考材料', output_type: '生成内容', agent_role: '由谁处理',
  evidence_required: '需要正文依据', auto_apply_allowed: '允许自动应用', review_policy: '确认方式',
  check_rules: '检查内容', proposal_fields: '建议包含的内容', tone: '语气', rules: '写作要求',
  logline: '一句话故事', theme: '主题', genre: '题材', keywords: '关键词', target_reader: '目标读者',
  platform_style: '平台风格', worldview: '世界背景', main_conflict: '主要冲突', banned_items: '禁写事项',
  important_scenes: '重要场景', scene: '场景', purpose: '作用', chapter: '对应章节',
  era: '时代', setting: '世界背景', locations: '重要地点', factions: '势力',
  sentence_length: '句子节奏', dialogue_ratio: '对话安排', punctuation: '标点习惯',
  style_guide: '文风要求', locks: '保持不变', pov: '叙述视角', tense: '叙述时态', taboo_words: '禁用表达',
  active_style_sample_asset_ids: '参考样本', injection_policy: '样本引用偏好',
  max_examples: '最多引用几段', max_chars_per_example: '每段最多字数',
  entry_type: '条目类型', direction: '世界方向', summary: '摘要', content: '设定正文',
  causes: '形成原因', consequences: '带来的影响', core: '核心设定',
  setting_status: '采用情况', canon_status: '可信程度', creation_status: '编写进度',
  introduced_chapter: '首次可用章节', domain_status: '可选世界方向',
  geography: '地理', biology: '生物', physics_magic: '物理与魔法', metaphysics: '形而上', technology: '科技', culture: '文化',
}
const IDENTITY_FIELDS: Record<string, string> = {
  gender: '自由填写，例如女性、无性别，或你世界中的自定义分类。',
  pronouns: '例如：他、她、TA，或你希望叙述时使用的代词。',
  address_notes: '补充本人物的称呼偏好与例外，不必重复世界通用规则。',
  address_as: '当前人物称呼上方关联人物的用语，例如：老师、阿姐；不是反向称呼。',
}
const VALUES: Record<string, string> = {
  brief: '轻量人物', detailed: '完整人物卡', protagonist: '主角', supporting: '配角', antagonist: '对手', other: '其他',
  checker: '检查', generator: '生成', research: '调研', tracker: '追踪', memory: '记忆整理',
  reviewer: '审查', writer: '写作', proofreader: '校对', researcher: '调研', system: '系统',
  character: '人物', story: '故事', world: '世界', style: '文风', chapter: '章节',
  unset: '未设置', not_applicable: '不适用', set: '已采用', canon: '已确定', hypothesis: '推定', inspiration: '灵感',
  new: '待起笔', draft: '草案', complete: '已完善', geography: '地理', biology: '生物', physics_magic: '物理与魔法', metaphysics: '形而上', technology: '科技', culture: '文化',
}
export const fieldLabel = (key: string) => LABELS[key] || ({ provider: '服务类型', model: '模型名称', base_url: '服务地址', api_key: '密钥', timeout_s: '等待时间', stream: '逐步显示' } as Record<string, string>)[key] || '补充内容'
export const profileLabel = (id: string, profile: any) => profile?.provider === 'mock' || id === 'mock_default' ? '模拟预览（不调用 AI）' : profile?.display_name || profile?.model || id

export function SchemaForm({ schema, value, onChange, projectId, profileId, references = [], onOpenMaterial, focusRequest, hiddenFields = [] }: {
  schema: any; value: any; onChange: (v: any) => void;
  projectId?: string; profileId?: string; references?: any[];
  onOpenMaterial?: OpenMaterial; focusRequest?: { requestId: number; editPath?: string[] } | null; hiddenFields?: string[];
}) {
  useEffect(() => {
    if (!focusRequest?.editPath?.length) return
    const target = document.getElementById(`card.${focusRequest.editPath.join('.')}`)
    target?.scrollIntoView({ block: 'center' })
    ;(target?.querySelector('input, textarea, select') as HTMLElement | null)?.focus()
  }, [focusRequest?.requestId, value?.id, schema])
  const latest = useRef(value)
  latest.current = value
  const generationRequest = useRef(0)
  useEffect(() => () => { generationRequest.current++ }, [projectId, value?.id])
  const [generating, setGenerating] = useState('')
  const [error, setError] = useState('')
  const [referenceUsage, setReferenceUsage] = useState<any>(null)
  const generate = async (path: string) => {
    const before = JSON.stringify(latest.current)
    const number = ++generationRequest.current
    setGenerating(path)
    setError('')
    setReferenceUsage(null)
    try {
      const parts = path.split('.').slice(1)
      const result = await api.post(`/api/projects/${projectId}/cards/generate-field`, { card: latest.current, path: parts, llm_profile_id: profileId })
      if (number !== generationRequest.current) return
      if (result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '生成失败，请检查模型设置。')
      setReferenceUsage(result.writing_reference_usage)
      if (JSON.stringify(latest.current) !== before) throw new Error('你在生成期间修改了资料，已保留你的编辑。请重试这一项。')
      const next = JSON.parse(before)
      let target = next
      for (const [index, key] of parts.slice(0, -1).entries()) {
        if (target[key] === undefined) target[key] = /^\d+$/.test(parts[index + 1] || '') ? [] : {}
        target = target[key]
      }
      target[parts[parts.length - 1]] = result.value
      if (next.type === 'character' && next.payload?.name) next.title = next.payload.name
      onChange(next)
    } catch (err) { if (number === generationRequest.current) setError(err instanceof Error ? err.message : '生成失败，请重试。') }
    finally { if (number === generationRequest.current) setGenerating('') }
  }
  const fieldHints: Record<string, string> = { appearance: '只写相对稳定的长相与初印象。衣着、神态和情绪会随剧情变化，不必在这里填写当前状态。', voice: '可写常用措辞、语速、停顿或表达方式；面对不同人、不同处境时也会改变。', family_background: '可写影响此人的几段经历，以及由此形成的信念与顾虑；不必写满生平。' }
  const generateButton = (path: string, label: string) => projectId && !IDENTITY_FIELDS[path.split('.').slice(-1)[0] || ''] ? <Button className='text-xs' disabled={Boolean(generating)} aria-label={`AI 生成${label}`} onClick={() => generate(path)}>{generating === path ? '生成中…' : 'AI 生成'}</Button> : null
  const renderFields = (properties: any, data: any, change: (next: any) => void, path: string) => (
    <div className={path === 'card.payload' ? 'schema-fields-grid' : 'space-y-5'}>
      {Object.entries(properties || {}).map(([key, spec]: any) => {
        if (hiddenFields.includes(key)) return null
        if (['writing_references', '_revision', 'detail_level', 'world_context', 'importance', 'stars'].includes(key)) return null
        if (value?.type === 'character' && value.payload?.detail_level === 'brief' && path === 'card.payload' && !['name', 'identity', 'initial_age', 'initial_age_time', 'gender', 'pronouns'].includes(key)) return null
        if (key === 'reference_image') return null
        if (key === 'extra_context' && value?.type === 'world') return null
        if (path === 'card' && ['id', 'type', 'links', 'stars', 'importance'].includes(key)) return null
        if (key === 'payload') return <div key={key}>{renderFields(spec.properties, data?.[key] || {}, (next) => change({ ...data, [key]: next }), `${path}.payload`)}</div>
        if (path === 'card' && key === 'title' && schema?.properties?.type?.const === 'character') return null
        const label = LABELS[key] || spec.title || '补充内容'
        const id = `${path}.${key}`
        const current = data?.[key]
        const update = (next: any) => change({ ...data, [key]: next })
        if (spec.type === 'object') return (
          <fieldset key={key} className='rounded-ui border border-border p-3'>
            <legend className='px-1 text-sm'>{label}</legend>
            <div className='mb-2 flex justify-end'>{generateButton(id, label)}</div>
            {renderFields(spec.properties, current || {}, update, id)}
          </fieldset>
        )
        if (spec.type === 'array' && spec.items?.type === 'object') return (
          <fieldset key={key} className='space-y-2 rounded-ui border border-border p-3'>
            <legend className='px-1 text-sm'>{label}</legend>
            <div className='mb-2 flex justify-end'>{generateButton(id, label)}</div>
            {(Array.isArray(current) ? current : []).map((item: any, index: number) => (
              <div key={index} id={`${id}.${index}`} className='space-y-2 rounded-ui bg-surface-2 p-3'>
                {renderFields(spec.items.properties, item, (next) => update(current.map((row: any, i: number) => i === index ? next : row)), `${id}.${index}`)}
                <Button className='text-xs' onClick={() => update(current.filter((_: any, i: number) => i !== index))}>移除这一项</Button>
              </div>
            ))}
            <Button className='text-xs' onClick={() => update([...(Array.isArray(current) ? current : []), {}])}>添加{label}</Button>
          </fieldset>
        )
        return (
          <div key={key} className={`space-y-2 ${spec.type === 'array' ? 'card-field-wide' : ''}`}>
            <div className='flex items-center justify-between gap-3'><label htmlFor={id} className='text-sm text-muted'>{label}</label>{generateButton(id, label)}</div>
            {key === 'target' && references.length ? (
              <Select id={id} value={current || ''} onChange={(e) => update(e.target.value)}>
                <option value=''>选择人物</option>
                {current && !references.some((card) => card.id === current) && <option value={current}>{references.find((card) => [card.title, card.payload?.name].includes(current))?.payload?.name || '原关联人物（保留）'}</option>}
                {references.map((card) => <option key={card.id} value={card.id}>{card.payload?.name || card.title || '未命名人物'}</option>)}
              </Select>
            ) : Array.isArray(spec.enum) ? (
              <Select id={id} value={current ?? spec.default ?? ''} onChange={(e) => update(e.target.value)}>
                <option value=''>请选择</option>
                {spec.enum.map((option: string) => <option key={option} value={option}>{VALUES[option] || option}</option>)}
              </Select>
            ) : spec.type === 'boolean' ? (
              <input id={id} type='checkbox' className='ml-2' checked={Boolean(current ?? spec.default)} onChange={(e) => update(e.target.checked)} />
            ) : spec.type === 'integer' || spec.type === 'number' ? (
              <Input id={id} type='number' min={spec.minimum} max={spec.maximum} value={current ?? ''} onChange={(e) => update(e.target.value === '' ? undefined : Number(e.target.value))} />
            ) : spec.type === 'array' ? (
              <Textarea id={id} className='min-h-20' placeholder='每行填写一项' value={(Array.isArray(current) ? current : []).join('\n')} onChange={(e) => update(e.target.value.split('\n').map((line) => spec.items?.type === 'number' ? Number(line) : line))} />
            ) : ['name', 'identity', 'title', 'era'].includes(key) ? (
              <Input id={id} value={current || ''} onChange={(e) => update(e.target.value)} />
            ) : (
              <Textarea id={id} className='min-h-20' placeholder={IDENTITY_FIELDS[key] || fieldHints[key]} value={current || ''} onChange={(e) => update(e.target.value)} />
            )}
            {value?.type === 'character' && fieldHints[key] && <p className='text-xs leading-6 text-muted'>{fieldHints[key]}</p>}
          </div>
        )
      })}
    </div>
  )
  return <Card title={schema?.properties?.type?.const === 'character' ? '人物资料' : '设定内容'}>
    {projectId && <p className='mb-4 text-sm text-muted'>可手动填写，也可逐项让 AI 生成。保存后，后续写作会使用这些最新设定。</p>}
    {value?.type === 'character' && <p className='mb-4 text-xs leading-6 text-muted'>性别与称呼可自由填写，也可留空。通用规则在世界资料的“通用称谓规则”中维护，这里只写本人物与特殊关系。</p>}
    {error && <p role='alert' className='mb-3 text-sm text-red-700 dark:text-red-300'>{error}</p>}
    <WritingReferenceNotice usage={referenceUsage} />
    {renderFields(schema?.properties, value, onChange, 'card')}
    {projectId && value?.payload?.writing_references?.length > 0 && ['character', 'world', 'style', 'story', 'outline'].includes(value?.type) && <details className='mt-6'><summary className='cursor-pointer text-xs text-muted'>既有技法关联（兼容保留）</summary><div className='mt-3'><WritingReferencePicker project={projectId} value={value?.payload?.writing_references || []} onChange={(ids) => onChange({ ...value, payload: { ...value?.payload, writing_references: ids } })} saveHint='旧关联继续保留。日常写法选择集中在正文页面，保存此卡后原关联生效。' /></div></details>}
    {projectId && ['character', 'world', 'style', 'story', 'outline'].includes(value?.type) && <div className='mt-5'><MaterialReferences project={projectId} sourceId={value?.id && !['character_new', 'story_new'].includes(value.id) ? value.id : undefined} value={value?.links || []} onChange={(links) => onChange({ ...value, links })} onOpen={onOpenMaterial} /></div>}
  </Card>
}
