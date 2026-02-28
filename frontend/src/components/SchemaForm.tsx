import React from 'react'
import { Card } from './ui/Card'
import { Input, Textarea } from './ui/Fields'

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
