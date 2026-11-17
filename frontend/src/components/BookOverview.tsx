import { Button } from './ui/Button'
import { Select } from './ui/Fields'
import type { OpenMaterial } from './MaterialReferences'

type Picture = { key: string; label: string; url: string; owner: string; type: string }

function picturesFor(project: string, cards: any[]): Picture[] {
  const base = `/api/projects/${project}`
  return cards.flatMap(card => {
    const portrait = card.payload?.reference_image?.asset_id
    if (card.type === 'character' && portrait) {
      return [{ key: card.id, label: card.payload.name || card.title, owner: card.id, type: card.type,
        url: `${base}/character-images/${encodeURIComponent(portrait)}` }]
    }
    return (card.payload?.maps || []).filter((map: any) => map.source?.batch_id && map.source.source_id).map((map: any) => {
      const { batch_id, source_id, page } = map.source
      const query = new URLSearchParams({ source_id })
      if (page !== undefined) query.set('page', String(page))
      return { key: `${card.id}:${map.id}`, label: map.title || card.title, owner: card.id, type: card.type,
        url: `${base}/material-imports/${batch_id}/source?${query}` }
    })
  })
}

export function BookOverview({ project, cards, events, story, onPicture, onOpenMaterial, onOpenEvent, onTimeline, onOutline }: {
  project: string; cards: any[]; events: any[]; story: any; onPicture: (key: string) => void;
  onOpenMaterial: OpenMaterial; onOpenEvent: (owner: string, scene: string) => void;
  onTimeline: () => void; onOutline: () => void;
}) {
  const pictures = picturesFor(project, cards)
  const selected = pictures.find(picture => picture.key === story.overview_picture) || pictures[0]
  const canonical = new Map<string, any>()
  for (const event of events) {
    const id = event.canonical_id || event.id
    if (!canonical.has(id) || event.id === id) canonical.set(id, event)
  }

  return <div className='book-overview'>
    <section className='space-y-3'>
      {selected && <div className='space-y-2'>
        <button onClick={() => onOpenMaterial({ id: selected.owner, type: selected.type })}>
          <img className='overview-picture' src={selected.url} alt={selected.label} />
        </button>
        {pictures.length > 1 && <Select aria-label='总览配图' value={selected.key} onChange={e => onPicture(e.target.value)}>
          {pictures.map(picture => <option key={picture.key} value={picture.key}>{picture.label}</option>)}
        </Select>}
      </div>}
      {story.logline && <p>{story.logline}</p>}
      <Button variant='ghost' onClick={onOutline}>{story.full_outline ? '继续编辑全书构想' : '写下全书构想'}</Button>
    </section>
    <section>
      <h2>关键事件</h2>
      {Array.from(canonical.values()).slice(0, 5).map(event => {
        const row = event.effective_values || event.values
        return <button className='overview-event' key={event.id} onClick={() => onOpenEvent(event.owner_card_id, event.scene_id)}>
          {row.time && <small>{row.time}</small>}{row.scene || row.purpose || '未命名事件'}
        </button>
      })}
      <Button variant='ghost' onClick={onTimeline}>打开故事时间线</Button>
    </section>
  </div>
}
