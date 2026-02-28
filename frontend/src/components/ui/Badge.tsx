export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'success' | 'warn' }) {
  const cls = tone === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : tone === 'warn' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-surface-2 text-muted'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${cls}`}>{children}</span>
}
