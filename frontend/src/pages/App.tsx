import { useMemo, useState } from 'react'
import useSWR from 'swr'
import Layout from '../components/Layout'
import { SchemaForm } from '../components/SchemaForm'
import { api } from '../api/client'

export default function App(){
  const [project,setProject]=useState('demo_project_001')
  const [view,setView]=useState('projects')
  const [events,setEvents]=useState<any[]>([])
  const [styleUploadText,setStyleUploadText]=useState('')
  const [activeStyleAssets,setActiveStyleAssets]=useState<string[]>([])
  const [llmProfileId,setLlmProfileId]=useState('mock_default')
  const [selectedChapter,setSelectedChapter]=useState('chapter_001')
  const [highlightRange,setHighlightRange]=useState<{start:number,end:number}|null>(null)
  const [assetViewer,setAssetViewer]=useState<{open:boolean,title:string,content:string}>({open:false,title:'',content:''})
  const [autoApplyPatch,setAutoApplyPatch]=useState(false)
  const [selectedOpIds,setSelectedOpIds]=useState<string[]>([])
  const [sessionMessageId,setSessionMessageId]=useState('writer_msg_001')
  const [sessionMessageText,setSessionMessageText]=useState('')

  const {data: projects, mutate:mutateProjects}=useSWR('/api/projects', api.get)
  const {data: projectInfo}=useSWR(project?`/api/projects/${project}`:null, api.get)
  const {data: charSchema}=useSWR('/api/schema/cards/character', api.get)
  const {data: styleSchema}=useSWR('/api/schema/cards/style', api.get)
  const {data: chars, mutate:mutateCards}=useSWR(project?`/api/projects/${project}/cards?type=character`:null, api.get)
  const {data: styles, mutate:mutateStyles}=useSWR(project?`/api/projects/${project}/cards?type=style`:null, api.get)
  const {data: draft, mutate:mutateDraft}=useSWR(project?`/api/projects/${project}/drafts/${selectedChapter}`:null, api.get)
  const {data: versions, mutate:mutateVersions}=useSWR(project?`/api/projects/${project}/drafts/${selectedChapter}/versions`:null, api.get)
  const {data: sessionMeta, mutate:mutateSessionMeta}=useSWR(project?`/api/projects/${project}/sessions/session_001/meta`:null, api.get)

  const [characterForm,setCharacterForm]=useState<any>({id:'character_new',type:'character',title:'',tags:[],links:[],payload:{}})
  const currentManifest = events.filter(e=>e.event==='CONTEXT_MANIFEST').slice(-1)[0]?.data
  const latestPatch = events.filter(e=>e.event==='EDITOR_PATCH').slice(-1)[0]?.data

  const uploadStyleSample = async () => {
    const fd = new FormData()
    const file = new File([styleUploadText], `style_${Date.now()}.txt`, { type: 'text/plain' })
    fd.append('file', file)
    fd.append('kind', 'style_sample')
    const r = await fetch(`/api/projects/${project}/uploads`, { method: 'POST', body: fd }).then(x=>x.json())
    const assetId = r.asset_id || r?.items?.[0]?.asset_id
    if(assetId) setActiveStyleAssets((x)=>[...x, assetId])
  }

  const analyzeStyle = async () => {
    await api.post(`/api/projects/${project}/style/analyze`, {style_card_id:'style_001', asset_ids: activeStyleAssets, mode:'fast'})
    mutateStyles()
  }

  const runJob=async(maxTokens=2400)=>{
    setSelectedOpIds([])
    const j=await api.post(`/api/projects/${project}/jobs/write`,{chapter_id:selectedChapter,blueprint_id:'blueprint_001',scene_index:0,agents:['director','writer'],llm_profile_id:llmProfileId,auto_apply_patch:autoApplyPatch,constraints:{max_tokens:maxTokens}})
    const ws = new WebSocket(`ws://127.0.0.1:8000/api/jobs/${j.job_id}/stream`)
    ws.onmessage=(e)=>{const evt=JSON.parse(e.data);setEvents(x=>[...x,evt]);if(evt.event==='DONE'){mutateDraft();mutateStyles();mutateVersions();mutateSessionMeta()}}
  }

  const applySelectedPatch = async () => {
    if(!latestPatch?.ops?.length) return
    const accept = selectedOpIds.length ? selectedOpIds : latestPatch.ops.map((o:any)=>o.op_id)
    await api.post(`/api/projects/${project}/drafts/${selectedChapter}/apply-patch`, {patch_id:latestPatch.patch_id, patch_ops:latestPatch.ops, accept_op_ids:accept})
    mutateDraft(); mutateVersions(); mutateSessionMeta()
  }

  const rollbackVersion = async (versionId:string)=>{
    await api.post(`/api/projects/${project}/drafts/${selectedChapter}/rollback`, {version_id:versionId})
    mutateDraft(); mutateVersions()
  }

  const openEvidence = async (ev:any) => {
    const src = ev?.source || {}
    if(ev?.kb_id === 'kb_manuscript' || src.chapter_id){
      const chapter = src.chapter_id || selectedChapter
      setSelectedChapter(chapter)
      setHighlightRange({start:src.start_line||1,end:src.end_line||20})
      setView('chapter')
      return
    }
    if(src.asset_id){
      const kind = src.kind === 'style_sample' ? 'style_sample' : 'doc'
      const r = await api.get(`/api/projects/${project}/assets/${src.asset_id}?kind=${kind}`)
      setAssetViewer({open:true,title:`${src.asset_id} (${kind})`,content:r.content || ''})
    }
  }

  const addMessageVersion = async ()=>{
    await api.post(`/api/projects/${project}/sessions/session_001/messages/${sessionMessageId}/versions`, {content:sessionMessageText, meta:{from:'ui'}})
    mutateSessionMeta()
  }

  const activateVersion = async (messageId:string, versionId:string)=>{
    await api.post(`/api/projects/${project}/sessions/session_001/messages/${messageId}/activate`, {version_id:versionId})
    mutateSessionMeta()
  }
  const doUndo = async ()=>{ await api.post(`/api/projects/${project}/sessions/session_001/undo`, {}); mutateSessionMeta() }
  const doRedo = async ()=>{ await api.post(`/api/projects/${project}/sessions/session_001/redo`, {}); mutateSessionMeta() }

  const profiles = projectInfo?.llm_profiles || {}
  const side=<div className='space-y-2 text-sm'>
    <button onClick={()=>setView('projects')}>ProjectList</button><br/>
    <button onClick={()=>setView('characters')}>Characters</button><br/>
    <button onClick={()=>setView('style')}>Style Studio</button><br/>
    <button onClick={()=>setView('chapter')}>ChapterEditor</button><br/>
    <button onClick={()=>setView('context')}>Context Panel</button><br/>
    <button onClick={()=>setView('sessions')}>Sessions</button>
  </div>

  const highlighted = useMemo(()=>{
    const lines = (draft?.content || '').split('\n')
    if(!highlightRange) return draft?.content
    return lines.map((l:string,i:number)=>{
      const n=i+1
      return (n>=highlightRange.start && n<=highlightRange.end) ? `>> ${n}: ${l}` : `${n}: ${l}`
    }).join('\n')
  },[draft,highlightRange])

  const center = useMemo(()=>{
    if(view==='projects') return <div><button className='border px-2' onClick={async()=>{const r=await api.post('/api/projects',{title:'新项目'});setProject(r.project_id);mutateProjects()}}>创建项目</button><div>{(projects||[]).map((p:any)=><div key={p.id} onClick={()=>setProject(p.id)} className='cursor-pointer'>{p.id} - {p.title}</div>)}</div></div>
    if(view==='characters') return <div><h3>角色集</h3><SchemaForm schema={charSchema} value={characterForm} onChange={setCharacterForm}/><button className='border px-2 mt-2' onClick={async()=>{await api.post(`/api/projects/${project}/cards`,characterForm);mutateCards()}}>保存角色</button><pre>{JSON.stringify(chars,null,2)}</pre></div>
    if(view==='style') return <div className='space-y-2'><h3>Style Studio</h3><textarea className='border p-1 w-full h-28' value={styleUploadText} onChange={e=>setStyleUploadText(e.target.value)} placeholder='粘贴文风样本文本 txt/md'/><button className='border px-2' onClick={uploadStyleSample}>上传样本</button><button className='border px-2 ml-2' onClick={analyzeStyle}>分析文风</button><div>Active Assets: {activeStyleAssets.join(', ')}</div><pre>{JSON.stringify(styles,null,2)}</pre><h4>Style schema</h4><pre>{JSON.stringify(styleSchema,null,2)}</pre></div>
    if(view==='chapter') return <div><h3>ChapterEditor</h3><div className='mb-2'>Chapter: <input value={selectedChapter} onChange={e=>setSelectedChapter(e.target.value)} className='border px-1'/></div><div className='mb-2'>模型：<select value={llmProfileId} onChange={e=>setLlmProfileId(e.target.value)}>{Object.entries(profiles).map(([k,v]:any)=><option key={k} value={k}>{k} ({v.provider}/{v.model})</option>)}</select></div><label className='text-sm'><input type='checkbox' checked={autoApplyPatch} onChange={e=>setAutoApplyPatch(e.target.checked)}/> 一键自动应用</label><div><button className='border px-2' onClick={()=>runJob(2400)}>生成本章</button><button className='border px-2 ml-2' onClick={()=>runJob(160)}>超预算模拟</button></div><pre>{highlighted}</pre><h4>Patch Review</h4><ul>{(latestPatch?.ops||[]).map((op:any)=><li key={op.op_id}><label><input type='checkbox' checked={selectedOpIds.includes(op.op_id)} onChange={e=>setSelectedOpIds(x=>e.target.checked?[...x,op.op_id]:x.filter(id=>id!==op.op_id))}/> {op.op_id} {op.type} {JSON.stringify(op.target_range)} - {op.rationale}</label><pre className='text-xs'>- {op.before || ''}{'\n'}+ {op.after || ''}</pre></li>)}</ul><button className='border px-2' onClick={applySelectedPatch}>应用勾选改动</button><h4>Versions</h4><ul>{(versions?.versions||[]).map((v:any)=><li key={v.version_id}><button className='underline' onClick={()=>rollbackVersion(v.version_id)}>{v.version_id}</button> {v.reason}</li>)}</ul></div>
    if(view==='sessions') return <div><h3>Sessions</h3><div><input className='border px-1' value={sessionMessageId} onChange={e=>setSessionMessageId(e.target.value)} placeholder='message_id'/><textarea className='border w-full h-20' value={sessionMessageText} onChange={e=>setSessionMessageText(e.target.value)} /><button className='border px-2' onClick={addMessageVersion}>新增消息版本</button><button className='border px-2 ml-2' onClick={doUndo}>Undo</button><button className='border px-2 ml-2' onClick={doRedo}>Redo</button></div><pre>{JSON.stringify(sessionMeta,null,2)}</pre><h4>切换版本</h4>{Object.entries(sessionMeta?.messages||{}).map(([mid,m]:any)=><div key={mid}><b>{mid}</b> active={m.active_version}<ul>{(m.versions||[]).map((v:any)=><li key={v.version_id}><button className='underline' onClick={()=>activateVersion(mid,v.version_id)}>{v.version_id}</button></li>)}</ul></div>)}</div>
    const evidence = currentManifest?.evidence || []
    return <div><h3>Context Manifest</h3><pre>{JSON.stringify(currentManifest,null,2)}</pre><h4>Evidence</h4><ul>{evidence.map((e:any)=><li key={`${e.kb_id}:${e.chunk_id}`}><button className='underline text-blue-600' onClick={()=>openEvidence(e)}>{e.kb_id}:{e.chunk_id}</button> ({e.source?.path})</li>)}</ul></div>
  },[view,projects,charSchema,characterForm,chars,styleSchema,styles,draft,project,activeStyleAssets,currentManifest,llmProfileId,profiles,selectedChapter,highlighted,latestPatch,selectedOpIds,versions,autoApplyPatch,sessionMessageId,sessionMessageText,sessionMeta])

  const providerInfo = events.filter(e=>e.event==='WRITER_DRAFT').slice(-1)[0]?.data
  const right=<div><h4>AgentConsole</h4><div className='text-xs mb-2'>provider: {providerInfo?.provider || '-'} / model: {providerInfo?.model || '-'} {providerInfo?.fallback ? '(fallback)' : ''}</div><pre className='text-xs whitespace-pre-wrap'>{events.map(e=>`${e.event}\n${JSON.stringify(e.data,null,2)}`).join('\n\n')}</pre>{assetViewer.open && <div className='mt-2 border p-2'><h5>Asset Viewer: {assetViewer.title}</h5><pre className='text-xs'>{assetViewer.content}</pre><button className='border px-1' onClick={()=>setAssetViewer({open:false,title:'',content:''})}>关闭</button></div>}</div>

  return <Layout left={side} center={center} right={right}/>
}
