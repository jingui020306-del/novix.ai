import { useEffect, useId, useRef, useState } from 'react'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Fields'
import { TokenUsage } from './WritingTools'

export type CharacterImage = { asset_id: string; sha256: string; mime_type: string; filename: string; url: string }
const imageKey = (value?: CharacterImage) => `${value?.asset_id || ''}:${value?.sha256 || ''}`
const EXTRACTION_RULE = '只提取可见的稳定外貌与初印象，例如发型、五官、体态和衣着。不要把悲伤、沮丧、崩溃等情境神态固定为每章外貌，不推断身份、动机、经历或性格。'

export function CharacterReferenceImage({ project, characterId, value, appearance, profileId, onImageChange, onApplyAppearance, onOpenSettings }: {
  project: string; characterId: string; value?: CharacterImage; appearance: string; profileId?: string;
  onImageChange: (value?: CharacterImage) => void; onApplyAppearance: (text: string) => void; onOpenSettings: () => void;
}) {
  const controlId = useId()
  const scope = `${project}:${characterId}`
  const signature = imageKey(value)
  const latest = useRef({ scope, signature, appearance })
  latest.current = { scope, signature, appearance }
  const uploadSequence = useRef(0)
  const analysisSequence = useRef(0)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [candidate, setCandidate] = useState<any>(null)
  useEffect(() => { uploadSequence.current++; analysisSequence.current++; setUploading(false); setAnalyzing(false); setInstructions(''); setMessage(''); setError(''); setCandidate(null); return () => { uploadSequence.current++; analysisSequence.current++ } }, [scope])
  useEffect(() => { analysisSequence.current++; setAnalyzing(false); setCandidate(null); setPreviewError(false) }, [signature])
  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setError('图片超过 5 MB，请缩小后重新选择。'); return }
    if (!['image/png', 'image/jpeg'].includes(file.type.toLowerCase()) && !(file.type === '' && /\.(png|jpe?g)$/i.test(file.name))) { setError('请选择 PNG 或 JPEG 图片。'); return }
    const number = ++uploadSequence.current
    const before = latest.current
    setUploading(true); setError(''); setMessage('')
    try {
      const body = new FormData(); body.append('file', file)
      const response = await fetch(`/api/projects/${project}/character-images`, { method: 'POST', body })
      const result = await response.json()
      if (!response.ok || result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '图片上传失败，请重试。')
      if (!result.asset_id || !result.sha256) throw new Error('图片未能完整保存，请重新上传。')
      if (number !== uploadSequence.current || latest.current.scope !== before.scope || latest.current.signature !== before.signature) return
      onImageChange({ asset_id: result.asset_id, sha256: result.sha256, mime_type: result.mime_type, filename: result.filename, url: result.url })
      setMessage('图片已加入人物表单，保存人物后关联生效。尚未调用模型。')
    } catch (cause) { if (number === uploadSequence.current && latest.current.scope === scope) setError(cause instanceof Error ? cause.message : '图片上传失败，请重试。') }
    finally { if (number === uploadSequence.current && latest.current.scope === scope) setUploading(false) }
  }
  const analyze = async () => {
    if (!value?.asset_id) return
    const before = latest.current
    const number = ++analysisSequence.current
    setAnalyzing(true); setError(''); setCandidate(null); setMessage('')
    try {
      const response = await fetch(`/api/projects/${project}/character-images/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_id: value.asset_id, llm_profile_id: profileId, instructions: `${EXTRACTION_RULE}${instructions.trim() ? `\n作者补充：${instructions.trim()}` : ''}` }) })
      const result = await response.json()
      if (!response.ok || result.detail) throw new Error(typeof result.detail === 'string' ? result.detail : '提取失败，请检查人物模型是否支持读图。')
      if (number !== analysisSequence.current || latest.current.scope !== before.scope) return
      if (latest.current.signature !== before.signature || latest.current.appearance !== before.appearance || result.asset_id !== value.asset_id || result.sha256 !== value.sha256) { setMessage('图片或外貌已变化，已保留你的编辑。请重新提取。'); return }
      const text = result.suggestion ?? result.text
      if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回可用的外貌描述，请重试。')
      setCandidate({ text, scope: before.scope, signature: before.signature, original: before.appearance, usage: result.usage, previousUsage: result.previous_usage, cached: Boolean(result.cached) })
    } catch (cause) { if (number === analysisSequence.current && latest.current.scope === scope) setError(cause instanceof Error ? cause.message : '提取失败，请检查模型设置。') }
    finally { if (number === analysisSequence.current && latest.current.scope === scope) setAnalyzing(false) }
  }
  const stale = candidate && (candidate.scope !== scope || candidate.signature !== signature || candidate.original !== appearance)
  const apply = () => {
    if (!candidate || stale) { setMessage('图片、人物或外貌已变化，旧候选未填入。请重新提取。'); return }
    onApplyAppearance(candidate.text)
    setCandidate(null); setMessage('候选已填入外貌，其他人物资料保留。请核对并保存人物。')
  }
  return <section className='border-y border-border py-4' aria-label='人物参考图'>
    <details open={Boolean(value?.asset_id)}><summary className='cursor-pointer text-sm font-medium'>人物参考图（可选）</summary><div className='mt-4 space-y-4'>
      <p className='text-xs leading-6 text-muted'>图片用于稳定外貌与初印象，不固定每章的表情。上传和保存不会自动读图，只有主动提取才调用人物任务模型。</p>
      {value?.asset_id && <div className='space-y-2'>{!previewError ? <img src={`/api/projects/${project}/character-images/${encodeURIComponent(value.asset_id)}`} alt='人物参考图' className='max-h-72 max-w-full object-contain' onError={() => setPreviewError(true)} /> : <p className='text-sm text-muted'>图片暂时无法预览，可以重新上传或移除关联。</p>}<p className='break-words text-xs text-muted'>{value.filename || '人物参考图'}</p><Button variant='ghost' className='text-xs' onClick={() => { uploadSequence.current++; analysisSequence.current++; onImageChange(undefined); setCandidate(null); setUploading(false); setAnalyzing(false); setError(''); setMessage('参考图已从人物表单移除，请保存人物后生效。') }}>移除参考图</Button></div>}
      <div className='space-y-2'><label className='block text-sm text-muted' htmlFor={`${controlId}-file`}>{value ? '替换本地图片' : '选择本地图片'}</label><Input id={`${controlId}-file`} type='file' accept='image/png,image/jpeg' disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} /><p className='text-xs text-muted'>PNG 或 JPEG，最多 5 MB。{uploading ? '正在上传…' : ''}</p></div>
      {value?.asset_id && <div className='space-y-3'><div><label className='mb-1 block text-xs text-muted' htmlFor={`${controlId}-instructions`}>提取要求（可选）</label><Input id={`${controlId}-instructions`} value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} placeholder='例如：重点记录发型与衣着，留出作者修改空间。' /></div><div className='flex flex-wrap gap-2'><Button disabled={analyzing || uploading} onClick={analyze}>{analyzing ? '正在提取…' : '从图片提取稳定外貌'}</Button><Button variant='ghost' className='text-xs' onClick={onOpenSettings}>查看人物模型设置</Button></div><p className='text-xs leading-5 text-muted'>需要所选模型支持读图。候选只作参考，不推断身份、动机或长期情绪；仍需作者核对。</p></div>}
      {candidate && <div className='space-y-3 border-t border-border pt-4'><label className='block text-sm font-medium' htmlFor={`${controlId}-candidate`}>待确认的稳定外貌 / 初印象</label><Textarea id={`${controlId}-candidate`} className='min-h-32' value={candidate.text} onChange={(event) => setCandidate({ ...candidate, text: event.target.value })} /><details><summary className='cursor-pointer text-xs text-muted'>查看提取时的外貌原文</summary><p className='mt-2 whitespace-pre-wrap text-sm leading-7 text-muted'>{candidate.original || '提取时尚未填写外貌。'}</p></details>{candidate.cached ? <><p className='text-xs text-muted'>已复用这张图片的提取结果，本次未再次调用模型。</p>{candidate.previousUsage && <details><summary className='cursor-pointer text-xs text-muted'>上次提取用量</summary><div className='mt-2'><TokenUsage usage={candidate.previousUsage} title='上次提取用量' /></div></details>}</> : <TokenUsage usage={candidate.usage} />}{stale && <p className='text-xs text-muted'>图片或外貌已有新编辑，请重新提取；当前外貌保留。</p>}<div className='flex flex-wrap gap-2'><Button variant='primary' disabled={stale || !candidate.text.trim()} onClick={apply}>确认填入外貌</Button><Button onClick={() => { setCandidate(null); setMessage('已保留原有外貌。') }}>保留原文</Button></div><p className='text-xs text-muted'>只改外貌字段；情绪与当下神态仍放在具体场景中表达。</p></div>}
    </div></details>
    {error && <div role='alert' className='mt-3 space-y-2'><p className='text-sm text-red-700 dark:text-red-300'>{error}</p><Button variant='ghost' className='text-xs' onClick={onOpenSettings}>去模型设置</Button></div>}
    {message && <p role='status' className='mt-3 text-xs leading-6 text-muted'>{message}</p>}
  </section>
}
