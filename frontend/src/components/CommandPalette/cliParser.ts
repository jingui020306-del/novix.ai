export type CreateType =
  | 'character'
  | 'world'
  | 'style'
  | 'outline'
  | 'lore'
  | 'world_rule'
  | 'blueprint'
  | 'chapter'
  | 'project'

export type ParsedCreate = {
  raw: string
  type: CreateType
  title: string
  opts: Record<string, string | number | boolean>
  tags: string[]
  locks: string[]
  flags: Record<string, boolean>
  errors: string[]
  warnings: string[]
}

const ALLOWED: Record<CreateType, Set<string>> = {
  character: new Set(['tag', 'age', 'gender', 'alias', 'note', 'importance']),
  world: new Set(['tag', 'type', 'atmosphere', 'desc']),
  style: new Set(['lock', 'max_examples', 'max_chars']),
  outline: new Set(['tag', 'note']),
  lore: new Set(['tag', 'type', 'desc']),
  world_rule: new Set(['tag', 'desc']),
  blueprint: new Set(['story_type', 'scenes']),
  chapter: new Set(['bind', 'scene', 'signals', 'no-signals']),
  project: new Set([]),
}

const BOOL_FLAGS = new Set(['signals', 'no-signals', 'auto-apply', 'no-auto-apply'])
const NUM_KEYS = new Set(['age', 'importance', 'scenes', 'scene', 'max_examples', 'max_chars'])

function stripPrefix(input: string): string {
  const t = input.trim()
  if (t.startsWith('+')) return t.slice(1).trim()
  if (/^create\s+/i.test(t)) return t.replace(/^create\s+/i, '').trim()
  return t
}

export function isCreateMode(input: string): boolean {
  const t = input.trim()
  return t.startsWith('+') || /^create\s+/i.test(t)
}

export function tokenize(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let esc = false

  for (const ch of input) {
    if (esc) {
      cur += ch
      esc = false
      continue
    }
    if (ch === '\\') {
      esc = true
      continue
    }
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function toNumber(raw: string, key: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if ((key === 'scenes' || key === 'scene') && n < 0) return null
  return n
}

export function parseCreateInput(input: string): ParsedCreate | null {
  if (!isCreateMode(input)) return null
  const source = stripPrefix(input)
  const tokens = tokenize(source)
  const errors: string[] = []
  const warnings: string[] = []
  const opts: Record<string, string | number | boolean> = {}
  const tags: string[] = []
  const locks: string[] = []
  const flags: Record<string, boolean> = {}

  const typeRaw = tokens.shift() || ''
  const type = typeRaw as CreateType
  if (!typeRaw) {
    return { raw: input, type: 'character', title: '', opts, tags, locks, flags, errors: ['Missing create type'], warnings }
  }
  if (!Object.keys(ALLOWED).includes(typeRaw)) {
    return { raw: input, type: 'character', title: '', opts, tags, locks, flags, errors: [`Unknown create type: ${typeRaw}`], warnings }
  }

  const titleParts: string[] = []
  while (tokens.length && !tokens[0].startsWith('--')) {
    titleParts.push(tokens.shift() as string)
  }

  while (tokens.length) {
    const tk = tokens.shift() as string
    if (!tk.startsWith('--')) {
      errors.push(`Unexpected token ${tk}`)
      continue
    }
    const key = tk.slice(2)
    const allowed = ALLOWED[type]
    if (!allowed.has(key) && !BOOL_FLAGS.has(key)) {
      errors.push(`Unknown option --${key}`)
      continue
    }

    if (BOOL_FLAGS.has(key)) {
      flags[key] = true
      opts[key] = true
      continue
    }

    const val = tokens[0] && !tokens[0].startsWith('--') ? (tokens.shift() as string) : ''
    if (!val) {
      errors.push(`Option --${key} needs a value`)
      continue
    }

    if (key === 'tag') {
      tags.push(val)
      continue
    }
    if (key === 'lock') {
      locks.push(val)
      continue
    }

    if (NUM_KEYS.has(key)) {
      const n = toNumber(val, key)
      if (n === null) {
        errors.push(`Invalid number for --${key}: ${val}`)
        continue
      }
      opts[key] = n
      continue
    }

    opts[key] = val
  }

  const title = titleParts.join(' ').trim()
  if (type !== 'project' && !title) errors.push('Missing title')
  if (type === 'project' && !title) errors.push('Missing project title')
  if (type === 'blueprint') {
    const scenes = Number(opts.scenes ?? 1)
    if (!Number.isFinite(scenes) || scenes < 1) errors.push('Blueprint requires --scenes >= 1')
  }

  return { raw: input, type, title, opts, tags, locks, flags, errors, warnings }
}

export function createHelpText(): string[] {
  return [
    '+ character Alice --tag 主角 --age 24 --gender female --alias 小A',
    '+ world 旧城区天桥 --tag 地点 --type location --atmosphere 冷清',
    '+ style 冷峻现实主义 --lock pov --lock tense --max_examples 5 --max_chars 800',
    '+ blueprint 三幕结构测试 --story_type three_act --scenes 3',
    '+ chapter 第一章 --bind blueprint_001 --scene 0 --signals',
    '+ project MyNovel',
  ]
}
