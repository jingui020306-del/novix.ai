import React from 'react'
export function SchemaForm({schema, value, onChange}:{schema:any,value:any,onChange:(v:any)=>void}){
  const props = schema?.properties || {}
  return <div className='space-y-2'>{Object.entries(props).map(([k,v]:any)=>{
    if(k==='tags'||k==='links') return <input key={k} className='border p-1 w-full' placeholder={k} value={(value[k]||[]).join(',')} onChange={e=>onChange({...value,[k]:e.target.value.split(',').filter(Boolean)})} />
    if(k==='payload') return <textarea key={k} className='border p-1 w-full h-40' value={JSON.stringify(value[k]||{},null,2)} onChange={e=>{try{onChange({...value,[k]:JSON.parse(e.target.value)})}catch{}}}/>
    return <input key={k} className='border p-1 w-full' placeholder={k} value={value[k]||''} onChange={e=>onChange({...value,[k]:e.target.value})}/>
  })}</div>
}
