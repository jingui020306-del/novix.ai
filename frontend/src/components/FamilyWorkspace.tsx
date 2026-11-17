import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { api } from '../api/client'
import { OpenMaterial } from './MaterialReferences'
import { WorldContextFields } from './WorldContextFields'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Fields'

type Member = {
  id: string
  name: string
  role: string
  trait: string
  age?: number | null
  existing: boolean
  locked: string[]
  blank: string[]
}
type Edge = { id: string; from_id: string; to_id: string; kind: string; existing?: boolean; scope?: Record<string, any> }
type Preview = {
  id: string
  revision: string
  status: 'draft' | 'applied' | 'undone' | 'live'
  center_id: string
  nodes: Member[]
  edges: Edge[]
  family_trait?: string
  similarity?: number
  conflict_targets?: Record<string, string[]>
  conflicts: string[]
  warnings: string[]
}
type Point = { x: number; y: number }
const kin: Record<string, string> = { parent: '亲生父母', adoptive_parent: '养父母', spouse: '配偶', guardian: '监护人', sibling: '手足' }
const choices: Record<string, string> = { maternal: '母系家族', paternal: '父系家族', sister: '姐妹', brother: '兄弟', spouse: '配偶' }
const personLabel = (node: Member) => node.name || node.role || '未命名亲属'
const familyBase = (project: string) => `/api/projects/${encodeURIComponent(project)}/family`

// Rank nodes by generation relative to the selected person. Only layout data is draggable.
function treePositions(preview: Preview) {
  const ranks = new Map([[preview.center_id, 0]])
  const neighbours = new Map<string, [string, number][]>()
  for (const { from_id, to_id, kind } of preview.edges) {
    const step = ['parent', 'adoptive_parent', 'guardian'].includes(kind) ? 1 : 0
    for (const [a, b, d] of [
      [from_id, to_id, step],
      [to_id, from_id, -step],
    ] as [string, string, number][]) {
      if (!neighbours.has(a)) neighbours.set(a, [])
      neighbours.get(a)!.push([b, d])
    }
  }
  const queue = [preview.center_id]
  for (let pos = 0; pos < queue.length; pos++) {
    const id = queue[pos]
    for (const [next, step] of neighbours.get(id) || [])
      if (!ranks.has(next)) {
        ranks.set(next, ranks.get(id)! + step)
        queue.push(next)
      }
  }
  const levels = new Map<number, Member[]>()
  for (const node of preview.nodes) {
    const rank = ranks.get(node.id) || 0
    if (!levels.has(rank)) levels.set(rank, [])
    levels.get(rank)!.push(node)
  }
  const width = Math.max(360, ...Array.from(levels.values(), (row) => row.length * 148))
  const height = Math.max(160, levels.size * 100)
  const points: Record<string, Point> = {}
  Array.from(levels.keys())
    .sort((a, b) => a - b)
    .forEach((rank, i) => {
      const row = levels.get(rank)!
      row.forEach((node, j) => {
        points[node.id] = { x: (width * (j + 0.5)) / row.length, y: i * 100 + 42 }
      })
    })
  return { points, width, height }
}

function FamilyTree({ project, preview, selected, onSelect }: { project: string; preview: Preview; selected: string; onSelect: (id: string) => void }) {
  const { points, width, height } = treePositions(preview)
  const layoutKey = `novix:family-layout:${project}:${preview.id}`
  const [moved, setMoved] = useState<Record<string, Point>>(() => {
    try {
      return JSON.parse(localStorage.getItem(layoutKey) || '{}') || {}
    } catch {
      return {}
    }
  })
  const drag = useRef<{ id: string; x: number; y: number; active: boolean } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const point = (id: string) => moved[id] || points[id]
  return (
    <div className="overflow-x-auto rounded-ui bg-surface-2">
      <svg
        ref={svg}
        role="group"
        aria-label="家谱预览，选择人物或关系"
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', width: '100%', minWidth: width, height }}
      >
        {preview.edges.map((edge) => {
          const a = point(edge.from_id),
            b = point(edge.to_id)
          if (!a || !b) return null
          const x = (a.x + b.x) / 2,
            y = (a.y + b.y) / 2
          return (
            <g
              key={edge.id}
              role="button"
              tabIndex={0}
              aria-label={`编辑关系：${kin[edge.kind] || edge.kind}`}
              className="cursor-pointer focus-ring"
              onClick={() => onSelect(edge.id)}
              onKeyDown={(e) => {
                if (['Enter', ' '].includes(e.key)) {
                  e.preventDefault()
                  onSelect(edge.id)
                }
              }}
            >
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={18} />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="currentColor"
                className={selected === edge.id ? 'text-brand-600' : 'text-muted'}
              />
              <rect x={x - 27} y={y - 10} width={54} height={20} className="fill-surface-2" rx={3} />
              <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="currentColor">
                {kin[edge.kind] || edge.kind}{preview.conflict_targets?.[edge.id]?.length ? ' ⚠' : ''}
              </text>
            </g>
          )
        })}
        {preview.nodes.map((node) => {
          const { x, y } = point(node.id)
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`编辑人物：${personLabel(node)}`}
              transform={`translate(${x} ${y})`}
              className="cursor-grab focus-ring"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                drag.current = { id: node.id, x: e.clientX, y: e.clientY, active: false }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const d = drag.current,
                  matrix = svg.current?.getScreenCTM()
                if (!d || d.id !== node.id || !matrix) return
                if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
                d.active = true
                const cursor = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
                setMoved((prev) => ({
                  ...prev,
                  [d.id]: { x: Math.max(54, Math.min(width - 54, cursor.x)), y: Math.max(24, Math.min(height - 24, cursor.y)) },
                }))
              }}
              onClick={(e) => {
                if (!drag.current?.active || e.detail === 0) onSelect(node.id)
                drag.current = null
              }}
              onPointerUp={() => {
                if (drag.current?.active) {
                  try {
                    localStorage.setItem(layoutKey, JSON.stringify(moved))
                  } catch {}
                }
              }}
              onPointerCancel={() => {
                drag.current = null
              }}
              onKeyDown={(e) => {
                if (['Enter', ' '].includes(e.key)) {
                  e.preventDefault()
                  onSelect(node.id)
                }
              }}
            >
              <title>
                {personLabel(node)} · {node.role}
              </title>
              <rect
                x={-52}
                y={-21}
                rx={5}
                width={104}
                height={42}
                className="fill-surface"
                stroke="currentColor"
                style={{ strokeWidth: selected === node.id ? 2 : 1 }}
                strokeDasharray={node.existing ? undefined : '4 2'}
              />
              <text textAnchor="middle" y={-1} fontSize={13} fill="currentColor">
                {Array.from(personLabel(node)).slice(0, 7).join('')}{preview.conflict_targets?.[node.id]?.length ? ' ⚠' : ''}
              </text>
              <text textAnchor="middle" y={14} fontSize={10} className="fill-current text-muted">
                {node.existing ? '已有' : '新增'} · {node.role}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function FamilyWorkspace({
  project,
  entityId,
  storyId,
  worldContext,
  disabled,
  onOpen,
}: {
  project: string
  entityId?: string
  storyId?: string
  worldContext?: any
  disabled?: boolean
  onOpen?: OpenMaterial
}) {
  const [opened, setOpened] = useState(false)
  const { data: people } = useSWR(opened ? `/api/projects/${project}/cards?type=character` : null, api.get)
  const [picked, setPicked] = useState('')
  const center = entityId || picked || people?.[0]?.id
  return (
    <details
      className="py-2"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true)
      }}
    >
      <summary className="cursor-pointer font-medium">生成亲属与家族</summary>
      {opened && (
        <div className="mt-3 space-y-3">
          {!entityId && (
            <label className="block text-sm">
              中心人物
              <Select value={center || ''} onChange={(e) => setPicked(e.target.value)}>
                {(Array.isArray(people) ? people : []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.payload?.name || c.title}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {disabled ? (
            <p className="text-sm text-muted">请先保存当前人物。</p>
          ) : center ? (
            <FamilyBuilder
              key={`${project}:${center}:${storyId || ''}`}
              project={project}
              center={center}
              storyId={storyId}
              inherited={worldContext}
              onOpen={onOpen}
            />
          ) : (
            <p className="text-sm text-muted">请先创建中心人物。</p>
          )}
        </div>
      )}
    </details>
  )
}

function FamilyBuilder({
  project,
  center,
  storyId,
  inherited,
  onOpen,
}: {
  project: string
  center: string
  storyId?: string
  inherited?: any
  onOpen?: OpenMaterial
}) {
  const base = familyBase(project),
    storageKey = `novix:family:${project}:${storyId || ''}:${center}`
  const [preview, setPreview] = useState<Preview | null>(null),
    [selected, select] = useState('')
  const [mode, setMode] = useState('maternal'),
    [limit, setLimit] = useState(5),
    [generations, setGenerations] = useState(2)
  const [familyTrait, setFamilyTrait] = useState(''), [similarity, setSimilarity] = useState(0.5)
  const [scope, setScope] = useState(inherited || {}),
    [blankNames, setBlankNames] = useState(false)
  const [showLive, setShowLive] = useState(false)
  const liveKey = showLive ? `${base}/tree?${new URLSearchParams({ center, story: storyId || '', scope: JSON.stringify(scope) })}` : null
  const { data: live, error: liveError } = useSWR<Preview>(liveKey, () =>
    api.post(`${base}/tree`, { center_id: center, story_card_id: storyId, world_context: scope }),
  )
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true)
  const [nodeChanges, setNodeChanges] = useState<Record<string, Partial<Member>>>({}),
    [edgeChanges, setEdgeChanges] = useState<Record<string, Partial<Edge>>>({})
  const alive = useRef(true)
  useEffect(() => {
    let cancelled = false
    alive.current = true
    async function restore() {
      try {
        const id = localStorage.getItem(storageKey)
        if (id) {
          const value = await api.get(`${base}/${encodeURIComponent(id)}`)
          if (!cancelled && value.center_id === center) {
            setPreview(value)
            select(value.nodes.find((n: Member) => !n.existing)?.id || center)
          }
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '上次预览未能读取。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void restore()
    return () => {
      cancelled = true
      alive.current = false
    }
  }, [base, center, storageKey])
  const remember = (result: Preview) => {
    if (!alive.current) return
    setPreview(result)
    setNodeChanges({})
    setEdgeChanges({})
    try {
      localStorage.setItem(storageKey, result.id)
    } catch {}
  }
  async function run(fn: () => Promise<void>) {
    if (busy || loading) return
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : '操作未完成。')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const dirty = Object.keys(nodeChanges).length > 0 || Object.keys(edgeChanges).length > 0
  const draft = showLive
    ? live
    : preview && {
        ...preview,
        nodes: preview.nodes.map((node) => ({ ...node, ...nodeChanges[node.id] })),
        edges: preview.edges.map((edge) => ({ ...edge, ...edgeChanges[edge.id] })),
      }
  const node = draft?.nodes.find((n) => n.id === selected),
    edge = draft?.edges.find((e) => e.id === selected)
  const editable = !showLive && preview?.status === 'draft'
  const setMember = (patch: Partial<Member>) => node && setNodeChanges((prev) => ({ ...prev, [node.id]: { ...prev[node.id], ...patch } }))
  const setEdge = (patch: Partial<Edge>) => edge && setEdgeChanges((prev) => ({ ...prev, [edge.id]: { ...prev[edge.id], ...patch } }))
  const generate = () =>
    run(async () => {
      if (dirty && !window.confirm('重新生成会替换当前预览。继续？')) return
      const result = await api.post(`${base}/preview`, {
        center_id: center,
        mode,
        limit,
        generations,
        world_context: scope,
        story_card_id: storyId,
        blank_names: blankNames, family_trait: familyTrait.trim(), similarity,
      })
      remember(result)
      setShowLive(false)
      select(result.nodes.find((n: Member) => !n.existing)?.id || center)
    })
  const savePreview = async (reroll?: { node_id: string; field: string }, omitIds?: string[]) => {
    if (!preview) throw new Error('请先生成预览。')
    if (!dirty && !reroll && !omitIds?.length) return preview
    const result: Preview = await api.put(`${base}/${preview.id}`, {
      revision: preview.revision,
      nodes: Object.entries(nodeChanges).map(([id, change]) => ({ id, ...change })),
      edges: Object.entries(edgeChanges).map(([id, change]) => ({ id, ...change })),
      reroll,
      omit_ids: omitIds,
    })
    remember(result)
    return result
  }
  const refresh = () =>
    mutate(
      (key: any) =>
        typeof key === 'string' &&
        key.startsWith(`/api/projects/${project}/`) &&
        /cards|relationships|materials|knowledge-graph|author-state|worlds|family\/tree/.test(key),
    )
  const apply = () =>
    run(async () => {
      const saved = await savePreview()
      if (saved.conflicts.length) return
      const reused = saved.nodes.filter((n) => n.existing).length
      if (!window.confirm(`新增 ${saved.nodes.length - reused} 人、复用 ${reused} 人，冲突 0 项。确认采用这份家谱？`)) return
      remember(await api.post(`${base}/${saved.id}/apply`, { revision: saved.revision }))
      await refresh()
    })
  const undo = () =>
    run(async () => {
      if (!preview || !window.confirm('撤销本次家谱生成？将核对后续修改和引用。')) return
      remember(await api.post(`${base}/${preview.id}/undo`, { revision: preview.revision }))
      await refresh()
    })
  const nodeEditable = Boolean(editable && node)
  return (
    <fieldset disabled={busy || loading} className="space-y-4" aria-label="家谱生成器" aria-busy={busy || loading}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          范围
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(choices).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          最多新增
          <Input type="number" min={0} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>
        <label className="text-sm">
          代数
          <Input type="number" min={1} max={5} value={generations} onChange={(e) => setGenerations(Number(e.target.value))} />
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-muted">家族共同倾向{draft?.family_trait ? ' · ' + draft.family_trait : ''}</summary>
        <div className="mt-2 flex flex-wrap gap-3">
          <label className="text-sm">性格倾向<Input value={familyTrait} onChange={e => setFamilyTrait(e.target.value)} placeholder="按世界性格词库填写，留空自动选取" /></label>
          <label className="text-sm">相似程度<Select value={similarity} onChange={e => setSimilarity(Number(e.target.value))}>
            <option value={0}>独立抽取</option><option value={0.5}>轻微相似</option><option value={1}>较为相似</option>
          </Select></label>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm text-muted">世界与时期</summary>
        <WorldContextFields project={project} storyId={storyId} value={scope} onChange={setScope} />
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!Number.isInteger(limit) || limit < 0 || limit > 30 || !Number.isInteger(generations) || generations < 1 || generations > 5}
          onClick={generate}
        >
          {preview ? '重新生成预览' : '生成预览'}
        </Button>
        <Button
          aria-pressed={showLive}
          onClick={() => {
            setShowLive(!showLive)
            select(center)
          }}
        >
          {showLive ? '返回生成预览' : '查看已保存家谱'}
        </Button>
        <label className="text-sm">
          <input type="checkbox" checked={blankNames} onChange={(e) => setBlankNames(e.target.checked)} /> 新增人物暂不取名
        </label>
      </div>
      {showLive && !live && (
        <p role="status" className="text-sm text-muted">
          {liveError?.message || '正在读取家谱…'}
        </p>
      )}
      {draft && (
        <>
          <FamilyTree key={draft.id} project={project} preview={draft} selected={selected} onSelect={select} />
          <Select aria-label="选择编辑的人物或关系" value={selected} onChange={(e) => select(e.target.value)}>
            {draft.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {personLabel(n)} · {n.role}
              </option>
            ))}
            {draft.edges.map((r) => (
              <option key={r.id} value={r.id}>
                {personLabel(draft.nodes.find((n) => n.id === r.from_id)!)} → {personLabel(draft.nodes.find((n) => n.id === r.to_id)!)} ·{' '}
                {kin[r.kind]}
              </option>
            ))}
          </Select>
          {node && !showLive && (
            <fieldset className="space-y-3" disabled={!nodeEditable}>
              <legend className="mb-2 text-sm font-medium">{node.role || '人物资料'}</legend>
              {(['name', 'trait', 'age'] as const).map((field) => {
                const label = { name: '姓名', trait: '性格', age: '年龄' }[field],
                  locked = (node.locked || []).includes(field),
                  blank = (node.blank || []).includes(field)
                return (
                  <div key={field} className="flex flex-wrap items-end gap-2">
                    <label className="min-w-32 flex-1 text-sm">
                      {label}
                      <Input
                        aria-label={`候选${label}`}
                        value={node[field] ?? ''}
                        type={field === 'age' ? 'number' : 'text'}
                        readOnly={locked || blank}
                        onChange={(e) =>
                          setMember({ [field]: field === 'age' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })
                        }
                      />
                    </label>
                    {nodeEditable && (
                      <>
                        <label className="text-xs">
                          <input
                            type="checkbox"
                            checked={locked}
                            disabled={blank}
                            onChange={(e) =>
                              setMember({ locked: e.target.checked ? [...(node.locked || []), field] : node.locked.filter((v) => v !== field) })
                            }
                          />{' '}
                          固定{label}
                        </label>
                        <label className="text-xs">
                          <input
                            type="checkbox"
                            checked={blank}
                            disabled={locked}
                            onChange={(e) =>
                              setMember(
                                e.target.checked
                                  ? { blank: [...(node.blank || []), field], [field]: field === 'age' ? null : '' }
                                  : { blank: node.blank.filter((v) => v !== field) },
                              )
                            }
                          />{' '}
                          {label}留白
                        </label>
                        {field !== 'age' && (
                          <Button
                            disabled={blank || locked}
                            onClick={() =>
                              run(async () => {
                                await savePreview({ node_id: node.id, field })
                              })
                            }
                          >
                            重抽{label}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
              {nodeEditable && !node.existing && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm('从预览中移除这位亲属？仅通过此人连接的成员也将从预览中移除。')) return
                      const next = await savePreview(undefined, [node.id])
                      select(next.nodes.find((n) => !n.existing)?.id || center)
                    })
                  }
                >
                  从预览移除
                </Button>
              )}
            </fieldset>
          )}
          {edge && !showLive && (
            <fieldset disabled={!editable || edge.existing} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {(['from_id', 'to_id'] as const).map((field, i) => (
                  <label key={field} className="text-sm">
                    {i ? '关系指向' : '关系起点'}
                    <Select value={edge[field]} onChange={(e) => setEdge({ [field]: e.target.value })}>
                      {draft.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {personLabel(n)}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
                <label className="text-sm">
                  关系类型
                  <Select value={edge.kind} onChange={(e) => setEdge({ kind: e.target.value })}>
                    {Object.entries(kin).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-muted">关系生效范围</summary>
                <WorldContextFields project={project} storyId={storyId} value={edge.scope || scope} onChange={(scope) => setEdge({ scope })} />
                <label className="mt-3 block text-sm">
                  失效年份（自该年起失效）
                  <Input
                    type="number"
                    step={1}
                    value={edge.scope?.until?.year ?? ''}
                    onChange={(e) => {
                      const current = edge.scope || scope
                      setEdge({
                        scope: { ...current, until: { ...current.until, year: e.target.value === '' ? undefined : Number(e.target.value) } },
                      })
                    }}
                  />
                </label>
              </details>
            </fieldset>
          )}
          {onOpen && ((node && (node.existing || draft.status === 'applied')) || (edge && (edge.existing || draft.status === 'applied'))) && (
            <Button
              variant="ghost"
              onClick={() => {
                if (!dirty || window.confirm('当前家谱预览有未保存的修改。仍要打开正式资料？'))
                  onOpen(node ? { id: node.id, type: 'character' } : { id: edge!.id, type: 'relationship' })
              }}
            >
              {node ? '打开人物资料' : '打开共享关系'}
            </Button>
          )}
          {draft.conflict_targets?.[selected]?.length ? <p role="status" className="text-sm">{draft.conflict_targets[selected].join(' ')}</p> : null}
          {draft.conflicts?.length > 0 && (
            <details><summary className="cursor-pointer text-sm">冲突（{draft.conflicts.length}）</summary>
              <ul className="list-disc pl-5 text-sm">{draft.conflicts.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </details>
          )}
          {draft.warnings?.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-muted">待核对（{draft.warnings.length}）</summary>
              <ul className="pl-4 text-sm">
                {draft.warnings.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {editable ? (
              <>
                <Button
                  disabled={!dirty}
                  onClick={() =>
                    run(async () => {
                      await savePreview()
                      setMessage('预览已保存。')
                    })
                  }
                >
                  保存预览
                </Button>
                <Button variant="primary" disabled={!dirty && !!draft.conflicts.length} onClick={apply}>
                  确认采用家谱
                </Button>
              </>
            ) : draft.status === 'applied' ? (
              <>
                <span className="text-sm text-muted">已采用</span>
                <Button onClick={undo}>撤销本次生成</Button>
              </>
            ) : draft.status === 'undone' ? (
              <span className="text-sm text-muted">已撤销</span>
            ) : null}
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </fieldset>
  )
}
