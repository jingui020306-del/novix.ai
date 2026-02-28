import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Layout from '../components/Layout'
import { SchemaForm } from '../components/SchemaForm'
import { api } from '../api/client'

export default function App(){
  const [project,setProject]=useState('demo_project_001')
  const [view,setView]=useState('characters')
  const [form,setForm]=useState<any>({id:'character_new',type:'character',title:'',tags:[],links:[],payload:{}})
  const [events,setEvents]=useState<any[]>([])
  const {data: projects, mutate:mutateProjects}=useSWR('/api/projects', api.get)
  const {data: charSchema}=useSWR('/api/schema/cards/character', api.get)
  const {data: chars, mutate:mutateCards}=useSWR(project?`/api/projects/${project}/cards?type=character`:null, api.get)
  const {data: bpSchema}=useSWR('/api/schema/blueprint', api.get)
  const {data: blueprints, mutate:mutateBp}=useSWR(project?`/api/projects/${project}/blueprints`:null, api.get)
  const {data: draft, mutate:mutateDraft}=useSWR(project?`/api/projects/${project}/drafts/chapter_001`:null, api.get)

  const side=<div className='space-y-2 text-sm'>
    <button onClick={()=>setView('projects')}>ProjectList</button><br/>
    <button onClick={()=>setView('characters')}>Characters</button><br/>
    <button onClick={()=>setView('blueprints')}>Blueprints</button><br/>
    <button onClick={()=>setView('chapter')}>ChapterEditor</button><br/>
    <button onClick={()=>setView('manifest')}>Context Manifest</button>
  </div>

  const runJob=async()=>{
    const j=await api.post(`/api/projects/${project}/jobs/write`,{chapter_id:'chapter_001',blueprint_id:'blueprint_001',scene_index:0,agents:['director','writer'],constraints:{signals:true,max_words:1200}})
    const ws = new WebSocket(`ws://localhost:8000/api/jobs/${j.job_id}/stream`)
    ws.onmessage=(e)=>{const evt=JSON.parse(e.data);setEvents(x=>[...x,evt]);if(evt.event==='DONE'){mutateDraft()}}
  }

  const center = useMemo(()=>{
    if(view==='projects') return <div><button className='border px-2' onClick={async()=>{const r=await api.post('/api/projects',{title:'新项目'});setProject(r.project_id);mutateProjects()}}>创建项目</button><div>{(projects||[]).map((p:any)=><div key={p.id} onClick={()=>setProject(p.id)} className='cursor-pointer'>{p.id} - {p.title}</div>)}</div></div>
    if(view==='characters') return <div><h3>角色集表单</h3><SchemaForm schema={charSchema} value={form} onChange={setForm}/><button className='border px-2 mt-2' onClick={async()=>{await api.post(`/api/projects/${project}/cards`,form);mutateCards()}}>保存角色</button><pre>{JSON.stringify(chars,null,2)}</pre></div>
    if(view==='blueprints') return <div><h3>BlueprintEditor</h3><SchemaForm schema={bpSchema} value={{id:'blueprint_001',story_type_id:'longform_novel',scene_plan:[{scene_id:'scene_1',phase:'setup',purpose:'开场',situation:'雨夜',choice_points:['赴约']}]}} onChange={()=>{}}/><button className='border px-2' onClick={async()=>{await api.post(`/api/projects/${project}/blueprints`,{id:'blueprint_001',story_type_id:'longform_novel',scene_plan:[{scene_id:'scene_1',phase:'setup',purpose:'开场',situation:'雨夜',choice_points:['赴约'],cast:['character_001'],beats:['beat_1']} ]});mutateBp()}}>保存蓝图</button><pre>{JSON.stringify(blueprints,null,2)}</pre></div>
    if(view==='chapter') return <div><h3>ChapterEditor</h3><button className='border px-2' onClick={runJob}>生成本章</button><pre>{draft?.content}</pre></div>
    return <pre>{JSON.stringify(events.filter(e=>e.event==='CONTEXT_MANIFEST').slice(-1)[0]?.data,null,2)}</pre>
  },[view,projects,charSchema,form,chars,bpSchema,blueprints,draft,project,events])

  const right=<div><h4>AgentConsole</h4><pre className='text-xs whitespace-pre-wrap'>{events.map(e=>`${e.event}\n${JSON.stringify(e.data,null,2)}`).join('\n\n')}</pre></div>

  return <Layout left={side} center={center} right={right}/>
}
