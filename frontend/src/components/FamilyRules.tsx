import { useState } from 'react'
import { WorldContextFields } from './WorldContextFields'
import { Input, Select, Textarea } from './ui/Fields'
import { Button } from './ui/Button'

type Rule = { id: string; label?: string; overrides?: string; scope?: Record<string, unknown>; values: Record<string, any> }
const pools = { surnames: '姓氏词库', given_names: '名字词库', traits: '家族性格倾向', forbidden: '禁用词' }

export function FamilyRules({
  project,
  value,
  onChange,
  disabled,
}: {
  project: string
  value: Rule[]
  onChange: (value: Rule[]) => void
  disabled: boolean
}) {
  const [selected, setSelected] = useState('')
  const rule = value.find((row) => row.id === selected) || value[0]
  const edit = (patch: Partial<Rule>) => onChange(value.map((row) => (row.id === rule.id ? { ...row, ...patch } : row)))
  const setValue = (key: string, next: unknown) => {
    const values = { ...rule.values }
    if (next === undefined) delete values[key]
    else values[key] = next
    edit({ values })
  }
  return (
    <details className="py-2">
      <summary className="cursor-pointer text-sm font-medium">姓氏与家族规则</summary>
      <fieldset disabled={disabled} className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {value.length > 0 && (
            <Select aria-label="选择家族规则" className="max-w-xs" value={rule.id} onChange={(e) => setSelected(e.target.value)}>
              {value.map((r, i) => (
                <option value={r.id} key={r.id}>
                  {r.label || `规则 ${i + 1}`}
                </option>
              ))}
            </Select>
          )}
          <Button
            onClick={() => {
              const id = `family_rule_${crypto.randomUUID().replace(/-/g, '')}`
              onChange([...value, { id, label: '', scope: {}, values: {} }])
              setSelected(id)
            }}
          >
            添加家族规则
          </Button>
        </div>
        {rule && (
          <div className="space-y-3" key={rule.id}>
            <label className="block text-sm">
              规则名称
              <Input value={rule.label || ''} onChange={(e) => edit({ label: e.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(pools).map(([key, label]) => {
                const pool = rule.values[key],
                  weighted = pool && !Array.isArray(pool)
                const words = weighted ? Object.keys(pool) : pool || []
                return (
                  <label className="block text-sm" key={key}>
                    {label}
                    <Textarea
                      key={rule.id}
                      aria-label={label}
                      placeholder="每行一项；空白沿用默认"
                      defaultValue={words.join('\n')}
                      onBlur={(e) => {
                        const terms = [
                          ...new Set(
                            e.currentTarget.value
                              .split('\n')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          ),
                        ]
                        if (terms.join('\n') === words.join('\n')) return
                        setValue(key, !terms.length ? undefined : weighted ? Object.fromEntries(terms.map((w) => [w, pool[w] || 1])) : terms)
                      }}
                    />
                  </label>
                )
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                姓氏来源
                <Select value={rule.values.surname_source || ''} onChange={(e) => setValue('surname_source', e.target.value || undefined)}>
                  <option value="">沿用世界规则</option>
                  <option value="pool">从词库取姓</option>
                  <option value="center">沿用中心人物姓氏</option>
                </Select>
              </label>
              <label className="text-sm">
                姓名顺序
                <Select value={rule.values.name_order || ''} onChange={(e) => setValue('name_order', e.target.value || undefined)}>
                  <option value="">沿用世界规则</option>
                  <option value="surname_first">姓在前</option>
                  <option value="given_first">名在前</option>
                </Select>
              </label>
              <label className="text-sm">
                辈字
                <Input value={rule.values.prefix || ''} onChange={(e) => setValue('prefix', e.target.value || undefined)} />
              </label>
              <label className="text-sm">
                寿命上限
                <Input
                  type="number"
                  min={0}
                  max={1000000}
                  value={rule.values.max_age ?? ''}
                  onChange={(e) => setValue('max_age', e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </label>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted">时期、地区与例外</summary>
              <WorldContextFields project={project} value={rule.scope || {}} onChange={(scope) => edit({ scope })} />
              {value.length > 1 && (
                <label className="block text-xs mt-3">
                  覆盖的规则
                  <Select value={rule.overrides || ''} onChange={(e) => edit({ overrides: e.target.value })}>
                    <option value="">不覆盖其他规则</option>
                    {value.slice(0, value.indexOf(rule)).map((r, i) => (
                      <option key={r.id} value={r.id}>
                        {r.label || `规则 ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </details>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm('从本条世界资料中移除这条规则？保存条目后生效。')) onChange(value.filter((r) => r.id !== rule.id))
              }}
            >
              移除规则
            </Button>
          </div>
        )}
      </fieldset>
    </details>
  )
}
