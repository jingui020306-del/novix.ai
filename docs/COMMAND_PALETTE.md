# Command Palette (⌘K / Ctrl+K)

## Shortcuts & prefixes

- Open: `⌘K` (macOS) / `Ctrl+K` (Windows/Linux)
- Close: `Esc`
- Move selection: `↑` / `↓`
- Execute: `Enter`
- Prefix modes:
  - `>` actions only
  - `@` characters only
  - `#` chapters only
  - `?` help
  - `+` or `create ` create mode

## Create command syntax

```text
+ <type> <title...> [--key value] [--flag]
create <type> <title...> [--key value] [--flag]
```

## Technique create commands

- `+ technique 冷笔触`
- `+ technique "平行蒙太奇" --category 结构手法 --alias montage --tag 叙事 --desc "并行剪辑" --signal "镜头并置" --step "交错切换" --intensity high`

Notes:
- `--category` resolves by category card `title`/`payload.name`.
- `--alias` / `--signal` / `--step` / `--tag` are repeatable.
- If only title is provided, palette fills default template (category guess + 3 apply_steps + 2 signals).

## Pin technique to current chapter

- `pin technique 蒙太奇 high`
- `pin technique "冷笔触" med --note "开头冷叙述，结尾留白" --weight 1.6`
- `pin tech 蒙太奇 high`
- `unpin technique 蒙太奇`
- `list pinned techniques`

Behavior:
- Requires current chapter context (`Chapter Editor`).
- Uses existing drafts meta GET/PUT.
- Upserts by `technique_id` in `pinned_techniques`.

## Two-level inheritance rule

- Outline defaults (`outline.payload.technique_prefs`) are baseline.
- Chapter pinned (`drafts/chapter_*.meta.json.pinned_techniques`) is override layer.
- Merge priority (same `technique_id`): `pinned > beat > chapter > arc`.
- Default weight fallback: `low=0.6`, `med=1.0`, `high=1.4`.
- Final selected order: pinned first, then beat, chapter, arc.

## Error strategy

- Missing title: `请输入名称` (no request sent)
- Invalid number (`--age`, `--importance`, pin `--weight`): inline error, no request sent
- Unknown option: `Unknown option --xxx`, no request sent
- API/server error: toast shows backend error detail when available

## Offline/failure behavior

Palette lazy-loads existing resources when opened. If API requests fail (offline/restricted network), local actions and help/create parsing still work.

## Manual acceptance checklist

1. 在 ChapterEditor 打开 `chapter_001`。
2. `⌘K/Ctrl+K`：输入 `pin technique 蒙太奇 high`。
3. 确认 `pinned_techniques` 已更新并在 Chapter UI 显示。
4. `⌘K/Ctrl+K`：输入 `+ technique 冷笔触`。
5. 在 Techniques 面板确认新增卡片并可编辑。
6. 运行“生成本章”，确认事件里有 `TECHNIQUE_BRIEF`。
7. 确认 `CONTEXT_MANIFEST.fixed_blocks` 含 `technique_brief`。
