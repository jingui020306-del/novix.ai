import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import { canonicalEvents, rootWorlds } from '../lib/materialScope'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Fields'

export function ChapterBranchTools({ project, chapterId, storyId, revision, dirty, profileId, onRestored, compareRequest }: {
  project: string; chapterId: string; storyId?: string; revision?: string; dirty: boolean; profileId?: string; onRestored: (value: string) => void; compareRequest?: { project: string; chapterId: string; versionId: string; requestId: number } | null;
}) {
  const base = `/api/projects/${project}`, chapter = `${base}/drafts/${chapterId}`
  const [version, setVersion] = useState('current')
  const [world, setWorld] = useState('')
  const [branch, setBranch] = useState('')
  const [forkEvent, setEvent] = useState('')
  const [label, setLabel] = useState('')
  const [draft, setDraft] = useState<any>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const panel = useRef<HTMLDetailsElement>(null)
  const handledRequest = useRef(0)
  const scope = `${project}:${chapterId}`
  const liveScope = useRef(scope); liveScope.current = scope
  const latestDirty = useRef(dirty); latestDirty.current = dirty
  useEffect(() => { liveScope.current = scope; return () => { liveScope.current = '' } }, [scope])
  useEffect(() => {
    if (!compareRequest || compareRequest.project !== project || compareRequest.chapterId !== chapterId || handledRequest.current === compareRequest.requestId) return
    handledRequest.current = compareRequest.requestId
    for (let element: HTMLElement | null = panel.current; element; element = element.parentElement) if (element.tagName === 'DETAILS') (element as HTMLDetailsElement).open = true
    panel.current?.scrollIntoView({ block: 'center' })
    if (draft) { setMessage('当前分支稿保留。请先保存并关闭分支稿，再点击“比较与恢复”。'); return }
    if (pending) { setMessage('当前操作尚未结束，请稍后再点击“比较与恢复”。'); return }
    setVersion(compareRequest.versionId); setMessage('')
  }, [compareRequest?.requestId, project, chapterId])
  const { data: history, mutate: refreshHistory } = useSWR(`${chapter}/versions`, api.get)
  const { data: comparison, mutate: refreshDiff } = useSWR(version !== 'current' ? `${chapter}/versions/${version}/compare` : null, api.get)
  const { data: worlds } = useSWR(`${base}/cards?type=world`, api.get)
  const { data: registry, mutate: refreshBranches } = useSWR(world ? `${base}/worlds/${world}/branches` : null, api.get)
  const { data: events } = useSWR(`${base}/events${storyId ? '?story_card_id=' + encodeURIComponent(storyId) : ''}`, api.get)
  const { data: saved, mutate: refreshDrafts } = useSWR(`${base}/chapters/${chapterId}/branch-drafts`, api.get)
  const worldRows = rootWorlds(worlds)
  const eventRows = canonicalEvents(events)
  const selectedEvent = eventRows.find((row: any) => row.id === forkEvent || row.choice_refs?.includes(forkEvent.replace(':important_scenes:', ':')))
  const existing = saved?.find((row: any) => row.origin.world_id === world && row.origin.branch_id === branch)

  const act = async (action: 'new' | 'open' | 'save' | 'generate' | 'restore') => {
    setPending(true); setMessage('')
    try {
      if (action === 'new') {
        const event = selectedEvent
        if (!event || !registry || !label.trim()) throw Error('请填写分支名称并选择分歧事件。')
        const bytes = crypto.getRandomValues(new Uint32Array(3))
        const id = 'branch_' + Array.from(bytes, n => n.toString(16).padStart(8, '0')).join('')
        const rows = [...registry.branches, { id, label: label.trim(), parent_branch_id: branch || 'main',
          fork_event_ref: { owner_card_id: event.owner_card_id, scene_id: event.scene_id } }]
        const result = await api.put(`${base}/worlds/${world}/branches`, { branches: rows, _revision: registry._revision })
        await refreshBranches(result, false); setBranch(id); setLabel(''); setMessage('已建立世界分支。')
      } else if (action === 'open') {
        const result = existing ? await api.get(`${base}/trials/${existing.id}`) :
          await api.post(`${base}/chapters/${chapterId}/branch-drafts`, { world_id: world, branch_id: branch, story_card_id: storyId,
            version_id: version, source_revision: version === 'current' ? revision : comparison?.source_revision })
        setDraft(result); await refreshDrafts()
      } else if (action === 'save' || action === 'generate') {
        const result = await api.put(`${base}/trials/${draft.id}`, { revision: draft.revision, text: draft.text, instructions: draft.instructions })
        setDraft(result)
        if (action === 'generate') {
          try {
            setDraft(await api.post(`${base}/trials/${draft.id}/generate`, { revision: result.revision,
              instructions: result.instructions, llm_profile_id: profileId }))
          } catch (error) {
            setDraft(await api.get(`${base}/trials/${draft.id}`))
            throw error
          }
        }
        setMessage('分支稿已保存。')
      } else if (action === 'restore') {
        if (dirty || draft) throw Error('请先保存当前正文，并保存、关闭分支稿，再比较恢复。')
        if (!comparison?.current_revision) throw Error('请先读取当前版本比较，再决定是否恢复。')
        if (!window.confirm('恢复这一版正文？当前正文将保留为快照。')) return
        const result = await api.post(`${chapter}/rollback`, { version_id: version, base_revision: comparison.current_revision })
        if (liveScope.current !== scope || !panel.current) return
        const editedDuringRestore = latestDirty.current
        if (!editedDuringRestore) onRestored(result.content)
        await refreshHistory(); await refreshDiff(); setMessage(editedDuringRestore ? '版本已恢复，等待期间的新编辑仍保留，请核对后再保存。' : '已恢复正文。')
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { setPending(false) }
  }

  return <details ref={panel} id='chapter-branch-tools'><summary className="cursor-pointer text-sm text-brand-600">版本比较与剧情分支</summary>
    <fieldset disabled={pending} className="mt-3 space-y-3">
      <label className="block text-sm">起始正文<Select disabled={!!draft} value={version} onChange={e => setVersion(e.target.value)}>
        <option value="current">当前已保存正文</option>{(history?.versions || []).map((v: any) => <option key={v.version_id} value={v.version_id}>{v.version_id} · {v.label}</option>)}
      </Select></label>
      {version !== 'current' && comparison && <div><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{comparison.diff || '与当前正文一致'}</pre>
        {(comparison.disclosures || []).map((r: any) => <p key={r.id} className="text-xs">需核对的读者揭晓：{r.quote}</p>)}
        <div className='mt-2 flex flex-wrap gap-2'><Button onClick={() => { void refreshDiff(); setMessage('正在重新比较当前保存版。') }}>重新比较当前正文</Button><Button disabled={dirty || !comparison.diff || !!draft || !comparison.current_revision} onClick={() => act('restore')}>恢复这一版</Button></div></div>}
      {!draft ? <>
        <Select aria-label="剧情分支的世界" value={world} onChange={e => { setWorld(e.target.value); setBranch(''); setMessage('') }}>
          <option value="">选择世界</option>{world && !worldRows.some((row: any) => row.id === world) && <option value={world}>{(worlds || []).find?.((row: any) => row.id === world)?.title || '原关联世界'}（归属待核对，保留）</option>}{worldRows.map((w: any) => <option key={w.id} value={w.id}>{w.title}</option>)}</Select>
        {world && <><Select aria-label="选择剧情分支" value={branch} onChange={e => setBranch(e.target.value)}>
          <option value="">主世界</option>{(registry?.branches || []).filter((b: any) => b.id !== 'main').map((b: any) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
          <details><summary className="cursor-pointer text-xs">从所选分支新建</summary><div className="mt-2 space-y-2">
            <Input aria-label="剧情分支名称" placeholder="分支名称" value={label} maxLength={100} onChange={e => setLabel(e.target.value)} />
            <Select aria-label="分歧事件" value={selectedEvent?.id || forkEvent} onChange={e => setEvent(e.target.value)}><option value="">选择分歧事件</option>
              {forkEvent && !selectedEvent && <option value={forkEvent}>原分歧事件暂未读到（保留待核对）</option>}{eventRows.map((e: any) => <option key={e.id} value={e.id}>{e.values?.scene || e.values?.plot || '未命名事件'}（{e.owner_card_id === storyId ? '故事策划' : '情节工作表'}）</option>)}</Select>
            <Button disabled={!registry || !label.trim() || !forkEvent} onClick={() => act('new')}>建立世界分支</Button></div></details>
          <Button disabled={!branch || (!existing && (dirty || (version !== 'current' && !comparison)))} onClick={() => act('open')}>{existing ? '打开分支稿' : '从此版本推演'}</Button></>}
      </> : <>
        <p className="text-sm">{draft.origin.label} · 分支正文</p>
        <Textarea aria-label="分支正文" className="min-h-48" value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} />
        <div className="flex gap-2"><Button onClick={() => act('save')}>保存分支稿</Button>
          <Button variant="ghost" onClick={async () => { try { const latest = await api.get(`${base}/trials/${draft.id}`); if ((latest.text === draft.text && latest.instructions === draft.instructions) || window.confirm('关闭并放弃未保存的分支编辑？')) setDraft(null) } catch { setMessage('暂未读到已保存版本。') } }}>关闭分支稿</Button></div>
        <details><summary className="cursor-pointer text-xs">用 AI 推演本分支</summary>
          <Textarea aria-label="分支推演要求" value={draft.instructions || ''} onChange={e => setDraft({ ...draft, instructions: e.target.value })} />
          <Button onClick={() => act('generate')}>生成分支试写</Button></details>
      </>}
    </fieldset>{message && <p role="status" className="text-sm">{message}</p>}
  </details>
}
