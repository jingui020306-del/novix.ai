import { useEffect, useRef, useState } from 'react'

export function cardAfterSave(current: any, submitted: any, result: any, before = JSON.stringify(submitted)) {
  if (JSON.stringify(current) === before && result.id === submitted.id && result.type === submitted.type && result.payload && typeof result.payload === 'object' && !Array.isArray(result.payload)) {
    const saved = { ...result }; delete saved.change_suggestions; delete saved._source_versions
    return saved
  }
  const metadata = { _revision: result._revision ?? submitted._revision ?? '', ...(result.updated_at ? { updated_at: result.updated_at } : {}) }
  let beforeValue: any = null
  try { beforeValue = JSON.parse(before) } catch {}
  const sameDraft = current?.id === submitted.id || current?.type === submitted.type && (!current?.id || /_new$/.test(current.id)) && beforeValue?.id === current.id
  const next = JSON.stringify(current) === before ? { ...submitted, ...metadata } : sameDraft ? { ...current, id: submitted.id, ...metadata } : current
  if (next && (next !== current || next.id === submitted.id)) { const clean = { ...next }; if (JSON.stringify(current?._source_versions) === JSON.stringify(submitted._source_versions)) delete clean._source_versions; return clean }
  return next
}

export function useDraftRecovery(key: string, value: any, baseline: string, onRestore: (draft: any) => void) {
  const acknowledged = useRef(new Set<string>())
  const [recovery, setRecovery] = useState<any>(null)
  const serialized = value ? JSON.stringify(value) : ''
  const dirty = Boolean(serialized && baseline && serialized !== baseline)
  useEffect(() => {
    setRecovery(null)
    try { const saved = JSON.parse(localStorage.getItem(`novix:draft:${key}`) || 'null'); if (saved?.draft && JSON.stringify(saved.draft) !== serialized) setRecovery({ ...saved, key }) } catch { /* An unreadable local draft never replaces author data. */ }
  }, [key])
  useEffect(() => {
    if (!value || !baseline || !dirty) return
    const save = () => {
      if (acknowledged.current.has(`${key}:${baseline}:${serialized}`)) return
      try { localStorage.setItem(`novix:draft:${key}`, JSON.stringify({ draft: value, saved_at: new Date().toISOString() })) } catch { /* The in-memory draft remains available if browser storage is full. */ }
    }
    const timer = window.setTimeout(save, 300)
    return () => { window.clearTimeout(timer); save() }
  }, [key, serialized, baseline, dirty])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  const scopedRecovery = recovery?.key === key ? recovery : null
  const markSaved = (submitted: any, saved: any) => {
    const snapshots = [JSON.stringify(submitted), JSON.stringify(saved)]
    for (const snapshot of snapshots) acknowledged.current.add(`${key}:${baseline}:${snapshot}`)
    try { const stored = JSON.parse(localStorage.getItem(`novix:draft:${key}`) || 'null'); if (stored?.draft && snapshots.includes(JSON.stringify(stored.draft))) localStorage.removeItem(`novix:draft:${key}`) } catch {}
    setRecovery((current: any) => current?.key === key && snapshots.includes(JSON.stringify(current.draft)) ? null : current)
  }
  return { recovery: scopedRecovery, dirty, markSaved, restore: () => { if (scopedRecovery?.draft) onRestore(scopedRecovery.draft); setRecovery(null) }, dismiss: () => { localStorage.removeItem(`novix:draft:${key}`); setRecovery(null) } }
}
