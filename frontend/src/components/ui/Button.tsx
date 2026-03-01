import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const styles: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 border-transparent',
  secondary: 'bg-surface border-border hover:bg-surface-2 text-text',
  ghost: 'bg-transparent border-transparent hover:bg-surface-2 text-muted',
}

export function Button({ className = '', variant = 'secondary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-ui px-3 py-1.5 text-sm border transition disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  )
}
