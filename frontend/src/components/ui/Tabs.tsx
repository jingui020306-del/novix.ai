export function Tabs({ items, active, onChange }: { items: string[]; active: string; onChange: (x: string) => void }) {
  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={`rounded-ui px-3 py-1 text-sm border ${active === item ? 'bg-brand-500 text-white border-brand-500' : 'bg-surface border-border text-muted'}`}
        >
          {item}
        </button>
      ))}
    </div>
  )
}
