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

export type KeyValueItem = {
  raw: string
  map: Record<string, string>
}

export type ParsedCreate = {
  raw: string
  type: CreateType
  title: string
  opts: Record<string, string | number | boolean | string[] | KeyValueItem[]>
  tags: string[]
  locks: string[]
  flags: Record<string, boolean>
  errors: string[]
  warnings: string[]
}

const ALLOWED: Record<CreateType, Set<string>> = {
  character: new Set(['tag', 'age', 'importance', 'role', 'identity', 'appearance', 'motivation', 'trait', 'family', 'voice', 'boundary', 'rel', 'arc']),
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
      if (ch === quote) quote = null
      else cur += ch
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

function parseKV(raw: string): KeyValueItem {
  const pairs = raw.split(',').map((x) => x.trim()).filter(Boolean)
  const map: Record<string, string> = {}
  for (const pair of pairs) {
    const [k, ...rest] = pair.split('=')
    if (!k) continue
    map[k.trim()] = rest.join('=').trim()
  }
  return { raw, map }
}

export function parseCreateInput(input: string): ParsedCreate | null {
  if (!isCreateMode(input)) return null
  const source = stripPrefix(input)
  const tokens = tokenize(source)
  const errors: string[] = []
  const warnings: string[] = []
  const opts: ParsedCreate['opts'] = {}
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
      let boolVal = true
      if (tokens[0] && !tokens[0].startsWith('--')) {
        const raw = String(tokens[0]).toLowerCase()
        if (['on', 'true', '1', 'yes'].includes(raw)) {
          boolVal = true
          tokens.shift()
        } else if (['off', 'false', '0', 'no'].includes(raw)) {
          boolVal = false
          tokens.shift()
        }
      }
      if (key === 'signals') {
        flags[boolVal ? 'signals' : 'no-signals'] = true
      } else if (key === 'no-signals') {
        flags[boolVal ? 'no-signals' : 'signals'] = true
      } else if (key === 'auto-apply') {
        flags[boolVal ? 'auto-apply' : 'no-auto-apply'] = true
      } else if (key === 'no-auto-apply') {
        flags[boolVal ? 'no-auto-apply' : 'auto-apply'] = true
      }
      opts[key] = boolVal
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
    if (key === 'trait' || key === 'boundary') {
      const prev = (opts[key] as string[] | undefined) || []
      opts[key] = [...prev, val]
      continue
    }
    if (key === 'rel' || key === 'arc') {
      const kvParts = [val]
      while (tokens.length && !tokens[0].startsWith('--') && tokens[0].includes('=')) {
        kvParts.push(tokens.shift() as string)
      }
      const prev = (opts[key] as KeyValueItem[] | undefined) || []
      opts[key] = [...prev, parseKV(kvParts.join(','))]
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
  if (type === 'project' && !title) errors.push('Missing project title')
  if (type !== 'project' && !title) errors.push('请输入名称')
  if (type === 'blueprint') {
    const scenes = Number(opts.scenes ?? 1)
    if (!Number.isFinite(scenes) || scenes < 1) errors.push('Blueprint requires --scenes >= 1')
  }

  return { raw: input, type, title, opts, tags, locks, flags, errors, warnings }
}

export function createHelpText(): string[] {
  return [
    '+ character Alice --tag 主角 --age 24 --importance 5 --role protagonist --identity "医学院研究生" --trait 冷静 --trait 克制',
    '+ world 旧城区天桥 --tag 地点 --type location --atmosphere 冷清',
    '+ style 冷峻现实主义 --lock pov --lock tense --max_examples 5 --max_chars 800',
    '+ blueprint 三幕结构测试 --story_type three_act --scenes 3',
    '+ chapter 第一章 --bind blueprint_001 --scene 0 --signals',
    '+ project MyNovel',
  ]
}
