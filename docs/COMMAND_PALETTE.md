# Command Palette (⌘K / Ctrl+K)

## Shortcuts & prefixes

- Open: `⌘K` (macOS) / `Ctrl+K` (Windows/Linux)
- Close: `Esc`
- Move selection: `↑` / `↓`
- Execute: `Enter`
- Prefix modes:
  - `>` Actions only
  - `@` Characters only
  - `#` Chapters only
  - `?` Help
  - `+` or `create ` Create mode

## Create command syntax

```text
+ <type> <title...> [--key value] [--flag]
create <type> <title...> [--key value] [--flag]
```

### Supported create types

- `project`
- `character`
- `world`
- `style`
- `outline`
- `lore`
- `world_rule`
- `blueprint`
- `chapter`

## CLI examples (10+)

1. `+ project My Novel`
2. `+ character Alice --tag 主角 --tag 都市 --age 24 --gender female --alias 小A`
3. `+ character 林秋 --importance 5 --note "冷静短句"`
4. `+ world 旧城区天桥 --tag 地点 --type location --atmosphere 冷清 --desc "夜里风大"`
5. `+ lore 黑潮同盟 --tag 势力 --desc "控制灰色航运"`
6. `+ world_rule 港区封锁法 --tag 规则 --desc "风暴红色预警时封港"`
7. `+ style 冷峻现实主义 --lock pov --lock tense --max_examples 5 --max_chars 800`
8. `+ outline 第一卷提纲 --note "主线推进"`
9. `+ blueprint 三幕结构测试 --story_type three_act --scenes 3`
10. `+ chapter 第一章 风从天桥吹下来 --bind blueprint_001 --scene 0 --signals`
11. `create chapter 第二章 雨夜追踪 --bind blueprint_001 --scene 1 --no-signals`

## Error strategy

- Unknown option (e.g. `--foo`): show `Unknown option --foo`, do not send request.
- Missing title (e.g. `+ character`): show `Missing title`, do not send request.
- Invalid number (e.g. `--age abc`): show `Invalid number for --age: abc`, do not send request.
- API/server errors: toast shows backend detail message when available.

## Mapping notes

- Character:
  - `--age -> payload.identity.age`
  - `--gender -> payload.identity.gender`
  - `--alias -> payload.meta.aliases[]`
  - `--tag -> tags[]` and tries `payload.meta.tags`
  - `--importance -> payload.meta.importance`
  - `--note -> payload.meta.note`
- World/Lore/World rule:
  - `--type -> payload.type`
  - `--desc -> payload.description`
  - `--atmosphere -> payload.atmosphere`
- Style:
  - `--lock -> payload.locks.*`
  - `--max_examples -> payload.injection_policy.max_examples`
  - `--max_chars -> payload.injection_policy.max_chars_per_example`
- Blueprint:
  - `--story_type -> story_type_id`
  - `--scenes N -> scene_plan with N minimal scenes`
- Chapter:
  - creates `ch_<timestamp>` via drafts PUT
  - writes chapter meta via drafts meta PUT
  - `--bind / --scene / --signals / --no-signals` mapped to meta fields

## Data loading behavior

On first open, palette lazy-loads resources using existing APIs only:

- projects
- cards (character/world/style/outline/lore/world_rule)
- blueprints
- drafts
- canon proposals

If loading fails (network/policy/restricted env), palette still works with local command actions (settings/toggles/refresh/help).

## Manual acceptance checklist

1. Press `⌘K` / `Ctrl+K` to open.
2. Press `Esc` to close.
3. Type `@` and check Characters filter.
4. Type `#` and check Chapters filter.
5. Type `>` and check Actions filter.
6. Type `?` and check help rows.
7. Run `+ character Alice --tag 主角 --age 24`.
8. Run `+ style 冷峻 --lock pov --max_examples 3`.
9. Run `+ blueprint 测试 --scenes 2`.
10. Run `+ chapter 第一章 --bind blueprint_001 --scene 0 --signals`.
11. Run `+ character` -> expect missing title error toast.
12. Run `+ character Alice --age abc` -> expect invalid number error toast.
13. Run `+ character Alice --foo bar` -> expect unknown option error toast.
