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

## Parameterized create examples

1. `+ character Alice --tag 主角 --age 24`
2. `+ character Alice --tag 主角 --importance 5 --role protagonist --identity "医学院研究生" --trait 冷静 --trait 克制`
3. `+ character Alice --appearance "黑色风衣" --motivation "查明真相" --family "单亲家庭" --voice "短句"`
4. `+ character Alice --boundary "不伤及无辜" --rel target=bob type=friend --arc beat=b1 goal="学会信任"`
5. `+ world "旧城区天桥" --tag 地点 --type location --atmosphere 冷清 --desc "夜里风大"`
6. `+ style 冷峻 --lock pov --max_examples 3 --max_chars 600`
7. `+ blueprint 三幕结构测试 --story_type three_act --scenes 2`
8. `+ chapter 第一章 --bind blueprint_001 --scene 0 --signals on`
9. `+ chapter 第二章 --bind blueprint_001 --scene 1 --no-signals`
10. `+ project My Novel`

## Character mapping rules

- `title` -> `card.title`, `payload.name`
- `--tag` (repeatable) -> `tags[]` (dedupe, preserve order)
- `--identity` -> `payload.identity`
- `--appearance` -> `payload.appearance`
- `--motivation` -> `payload.core_motivation`
- `--trait` (repeatable) -> `payload.personality_traits[]`
- `--family` -> `payload.family_background`
- `--voice` -> `payload.voice`
- `--boundary` (repeatable) -> `payload.boundaries[]`
- `--rel target=<id> type=<type>` (repeatable) -> `payload.relationships[]`
- `--arc beat=<id> goal=<text>` (repeatable) -> `payload.arc[]`
- `--age` -> `payload.age` (number)
- `--importance` -> `payload.importance` (number)
- `--role` -> `payload.role`

### Tag canonicalization

- If tags include `主角/配角/反派`, palette also appends canonical tags `protagonist/supporting/antagonist`.
- If `--role` is not provided, role is inferred from canonical tag.
- If `--importance` is not provided, defaults by role: protagonist=5, antagonist=4, supporting=3.

## Error strategy

- Missing title: `请输入名称` (no request sent)
- Invalid number (`--age`, `--importance`): inline error, no request sent
- Unknown option: `Unknown option --xxx`, no request sent
- API/server error: toast shows backend error detail when available

## Offline/failure behavior

Palette lazy-loads existing resources when opened. If API requests fail (offline/restricted network), local actions and help/create parsing still work.

## Manual acceptance checklist

1. Press `⌘K` / `Ctrl+K` to open palette.
2. `Esc` closes palette.
3. `@` filters characters.
4. `#` filters chapters.
5. `>` shows action commands.
6. `?` shows shortcut/prefix/create help.
7. Run `+ character Alice --tag 主角 --age 24`.
8. Open Alice card and confirm Role=`protagonist`, Importance=`5`, Age=`24`, all editable.
9. Run `+ style 冷峻 --lock pov --max_examples 3`.
10. Run `+ blueprint 测试 --scenes 2`.
11. Run `+ chapter 第一章 --bind blueprint_001 --scene 0 --signals on`.
12. Error check: `+ character` => missing title error.
13. Error check: `+ character Alice --age abc` => invalid number error.
14. Error check: `+ character Alice --foo bar` => unknown option error.
15. Modify Alice importance in form, save, refresh, value persists.
