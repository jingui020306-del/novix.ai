import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-sm focus-ring ${props.className || ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-sm focus-ring ${props.className || ''}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-ui border border-border bg-surface px-2 py-1.5 text-sm focus-ring ${props.className || ''}`} />
}
