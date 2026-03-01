import React from 'react'
import { Card } from './ui/Card'
import { Input, Select, Textarea } from './ui/Fields'

export function SchemaForm({ schema, value, onChange }: { schema: any; value: any; onChange: (v: any) => void }) {
  const props = schema?.properties || {}

  return (
    <Card title='Schema Form'>
      <div className='space-y-3 density-space'>
        {Object.entries(props).map(([k, v]: any) => {
          const label = v?.title || k
          const helper = v?.description || ''

          if (k === 'tags' || k === 'links') {
            return (
              <div key={k} className='grid grid-cols-12 items-start gap-3'>
                <label className='col-span-3 text-sm text-muted pt-2'>{label}</label>
                <div className='col-span-9'>
                  <Input
                    placeholder='comma-separated'
                    value={(value[k] || []).join(',')}
                    onChange={(e) => onChange({ ...value, [k]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                  />
                  {helper && <p className='mt-1 text-xs text-muted'>{helper}</p>}
                </div>
              </div>
            )
          }

          if (k === 'payload') {
            return (
              <div key={k} className='grid grid-cols-12 items-start gap-3'>
                <label className='col-span-3 text-sm text-muted pt-2'>{label}</label>
                <div className='col-span-9'>
                  <Textarea
                    className='h-44 mono'
                    value={JSON.stringify(value[k] || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        onChange({ ...value, [k]: JSON.parse(e.target.value) })
                      } catch {
                        // keep typing tolerant
                      }
                    }}
                  />
                  {helper && <p className='mt-1 text-xs text-muted'>{helper}</p>}
                </div>
              </div>
            )
          }

          if (Array.isArray(v?.enum)) {
            return (
              <div key={k} className='grid grid-cols-12 items-start gap-3'>
                <label className='col-span-3 text-sm text-muted pt-2'>{label}</label>
                <div className='col-span-9'>
                  <Select value={value[k] || ''} onChange={(e) => onChange({ ...value, [k]: e.target.value })}>
                    <option value=''>-- select --</option>
                    {v.enum.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </Select>
                  {helper && <p className='mt-1 text-xs text-muted'>{helper}</p>}
                </div>
              </div>
            )
          }

          if (v?.type === 'integer' || v?.type === 'number') {
            const min = v?.minimum ?? v?.min
            const max = v?.maximum ?? v?.max
            return (
              <div key={k} className='grid grid-cols-12 items-start gap-3'>
                <label className='col-span-3 text-sm text-muted pt-2'>{label}</label>
                <div className='col-span-9'>
                  <Input
                    type='number'
                    min={min}
                    max={max}
                    placeholder={k}
                    value={value[k] ?? ''}
                    onChange={(e) => onChange({ ...value, [k]: e.target.value === '' ? '' : Number(e.target.value) })}
                  />
                  {(min !== undefined || max !== undefined) && <p className='mt-1 text-xs text-muted'>range: {min ?? '-∞'} ~ {max ?? '∞'}</p>}
                  {helper && <p className='mt-1 text-xs text-muted'>{helper}</p>}
                </div>
              </div>
            )
          }

          return (
            <div key={k} className='grid grid-cols-12 items-start gap-3'>
              <label className='col-span-3 text-sm text-muted pt-2'>{label}</label>
              <div className='col-span-9'>
                <Input placeholder={k} value={value[k] || ''} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
                {helper && <p className='mt-1 text-xs text-muted'>{helper}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
