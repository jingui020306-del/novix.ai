import useSWR from 'swr'
import { api } from '../api/client'
import { OpenMaterial } from './MaterialReferences'

export function ContextMaterialSummary({ project, chapterId, pack, onOpen }: { project: string; chapterId: string; pack: any; onOpen: OpenMaterial }) {
  const { data } = useSWR(project ? `/api/projects/${project}/materials` : null, api.get)
  const { data: jobs } = useSWR(project && chapterId ? `/api/projects/${project}/jobs?chapter_id=${encodeURIComponent(chapterId)}` : null, api.get, { refreshInterval: 2500 })
  const latestJob = Array.isArray(jobs) ? jobs[0] : null
  const { data: detail } = useSWR(latestJob?.job_id ? `/api/projects/${project}/jobs/${latestJob.job_id}` : null, api.get, { refreshInterval: latestJob && !['completed', 'failed', 'cancelled'].includes(latestJob.status) ? 1800 : 0 })
  const materialPack = latestJob ? detail?.context_manifest?.context_pack : pack
  if (!materialPack) return null
  const ids: string[] = Array.isArray(materialPack.used_ids) ? materialPack.used_ids : []
  const citations = Array.isArray(materialPack.citations) ? materialPack.citations : []
  return <section className='space-y-2 border-t border-border pt-3' aria-label='本次生成采用的资料'><p className='text-sm'>本次采用 {ids.length} 项资料，省略 {Number(materialPack.dropped_count) || 0} 项。</p><details><summary className='cursor-pointer text-xs text-brand-600'>查看来源</summary><ul className='mt-3 space-y-3'>{ids.map((id, index) => { const material = (Array.isArray(data) ? data : []).find((row: any) => row.id === id); const citation = citations.find((row: any) => row.id === id); return <li key={id}><button className='text-left text-sm text-brand-600 hover:underline focus-ring' disabled={!material} onClick={() => material && onOpen(material)}>{material?.label || `采用的资料 ${index + 1}`}</button>{citation?.source && <details><summary className='mt-1 cursor-pointer text-xs text-muted'>原资料位置</summary><p className='mt-1 break-all text-xs text-muted'>{typeof citation.source === 'string' ? citation.source : citation.source.path || '作者资料'}</p></details>}</li> })}</ul>{Number(materialPack.deduplicated_count) > 0 && <p className='mt-3 text-xs text-muted'>重复引用已合并。资料范围受本次材料预算限制，不代表已核查全书。</p>}</details></section>
}
