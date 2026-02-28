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

  const {data: projects, mutate:mutateProjects}=useSWR('/api/projects', api.get)
  const {data: charSchema}=useSWR('/api/schema/cards/character', api.get)
  const {data: styleSchema}=useSWR('/api/schema/cards/style', api.get)
  const {data: chars, mutate:mutateCards}=useSWR(project?`/api/projects/${project}/cards?type=character`:null, api.get)
  const {data: styles, mutate:mutateStyles}=useSWR(project?`/api/projects/${project}/cards?type=style`:null, api.get)
  const {data: draft, mutate:mutateDraft}=useSWR(project?`/api/projects/${project}/drafts/chapter_001`:null, api.get)

  const [characterForm,setCharacterForm]=useState<any>({id:'character_new',type:'character',title:'',tags:[],links:[],payload:{}})
  const currentManifest = events.filter(e=>e.event==='CONTEXT_MANIFEST').slice(-1)[0]?.data

  const uploadStyleSample = async () => {
    const fd = new FormData()
    const file = new File([styleUploadText], `style_${Date.now()}.txt`, { type: 'text/plain' })
    fd.append('file', file)
    fd.append('kind', 'style_sample')
    const r = await fetch(`http://localhost:8000/api/projects/${project}/uploads`, { method: 'POST', body: fd }).then(x=>x.json())
    setActiveStyleAssets((x)=>[...x, r.asset_id])
  }

  const analyzeStyle = async () => {
    await api.post(`/api/projects/${project}/style/analyze`, {style_card_id:'style_001', asset_ids: activeStyleAssets, mode:'fast'})
    mutateStyles()
  }

  const queryExamples = async () => {
    return api.post(`/api/projects/${project}/kb/query`, {kb_id:'kb_style', query:'雨夜 抉择 调查', top_k:5, filters:{asset_ids:activeStyleAssets}})
  }

  const runJob=async(maxTokens=2400)=>{
    const j=await api.post(`/api/projects/${project}/jobs/write`,{chapter_id:'chapter_001',blueprint_id:'blueprint_001',scene_index:0,agents:['director','writer'],constraints:{max_tokens:maxTokens}})
    const ws = new WebSocket(`ws://localhost:8000/api/jobs/${j.job_id}/stream`)
    ws.onmessage=(e)=>{const evt=JSON.parse(e.data);setEvents(x=>[...x,evt]);if(evt.event==='DONE'){mutateDraft();mutateStyles()}}
  }

  const side=<div className='space-y-2 text-sm'>
    <button onClick={()=>setView('projects')}>ProjectList</button><br/>
    <button onClick={()=>setView('characters')}>Characters</button><br/>
    <button onClick={()=>setView('style')}>Style Studio</button><br/>
    <button onClick={()=>setView('chapter')}>ChapterEditor</button><br/>
    <button onClick={()=>setView('context')}>Context Panel</button>
  </div>

  const center = useMemo(()=>{
    if(view==='projects') return <div><button className='border px-2' onClick={async()=>{const r=await api.post('/api/projects',{title:'新项目'});setProject(r.project_id);mutateProjects()}}>创建项目</button><div>{(projects||[]).map((p:any)=><div key={p.id} onClick={()=>setProject(p.id)} className='cursor-pointer'>{p.id} - {p.title}</div>)}</div></div>
    if(view==='characters') return <div><h3>角色集</h3><SchemaForm schema={charSchema} value={characterForm} onChange={setCharacterForm}/><button className='border px-2 mt-2' onClick={async()=>{await api.post(`/api/projects/${project}/cards`,characterForm);mutateCards()}}>保存角色</button><pre>{JSON.stringify(chars,null,2)}</pre></div>
    if(view==='style') return <div className='space-y-2'><h3>Style Studio</h3><textarea className='border p-1 w-full h-28' value={styleUploadText} onChange={e=>setStyleUploadText(e.target.value)} placeholder='粘贴文风样本文本 txt'/><button className='border px-2' onClick={uploadStyleSample}>上传样本</button><button className='border px-2 ml-2' onClick={analyzeStyle}>分析文风</button><button className='border px-2 ml-2' onClick={async()=>{const ex=await queryExamples();alert(`examples:${ex.length}`)}}>预览示例</button><div>Active Assets: {activeStyleAssets.join(', ')}</div><pre>{JSON.stringify(styles,null,2)}</pre><h4>Style schema</h4><pre>{JSON.stringify(styleSchema,null,2)}</pre></div>
    if(view==='chapter') return <div><h3>ChapterEditor</h3><button className='border px-2' onClick={()=>runJob(2400)}>生成本章</button><button className='border px-2 ml-2' onClick={()=>runJob(160)}>超预算模拟</button><pre>{draft?.content}</pre></div>
    return <div><h3>Context Manifest</h3><pre>{JSON.stringify(currentManifest,null,2)}</pre></div>
  },[view,projects,charSchema,characterForm,chars,styleSchema,styles,draft,project,activeStyleAssets,currentManifest])

  const right=<div><h4>AgentConsole</h4><pre className='text-xs whitespace-pre-wrap'>{events.map(e=>`${e.event}\n${JSON.stringify(e.data,null,2)}`).join('\n\n')}</pre></div>

  return <Layout left={side} center={center} right={right}/>
}
