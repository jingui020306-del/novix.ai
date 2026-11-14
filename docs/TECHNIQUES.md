# Technique System

## 宏观分类（Macro）+ 微观技法（Micro）

- 宏观：`technique_category`（一级主类：修辞/表现/结构/描写/叙事/抒情，以及二/三级子类）。
- 微观：`technique`（可执行技法卡，含 `apply_steps` 与 `signals`）。
- 每个分类卡支持 `payload.core_techniques`（10~20 个推荐 micro）。

## 挂载结构

### Outline 默认倾向（长期）

`outline.payload.technique_prefs[]` 支持：

- `scope`: `arc|chapter|beat`
- `ref`: `arc_main` / `chapter_001` / `chapter_001.b0`
- `categories[]`: 宏观分类挂载
- `techniques[]`: 微观技法挂载

### Chapter 覆盖层（当章）

`drafts/chapter_xxx.meta.json.pinned_techniques[]`

## 合并规则

1. 先合并 outline（具体性优先：`beat > chapter > arc`）。
2. 再由 chapter pinned 最终覆盖同 `technique_id`。
3. 默认权重：`low=0.6`, `med=1.0`, `high=1.4`。
4. 若 pinned 提供 `weight`，以 pinned 为准。
5. 输出顺序：`pinned` 在前，其次 `outline:beat`、`outline:chapter`、`outline:arc`。

## Macro 自动推荐 Micro

当仅挂载分类（macro）时，TechniqueDirector 会从分类卡 `core_techniques` 自动挑选 3~5 个 micro 加入 checklist，来源标记为 `auto_from_category`。

## Pipeline 接入

- `DIRECTOR_PLAN` 后触发 `TECHNIQUE_BRIEF`。
- `CONTEXT_MANIFEST.fixed_blocks` 注入：
  - `technique_brief`
  - `technique_checklist`
  - `technique_style_constraints`
- 预算不足时只裁剪解释，不丢 checklist。

## Command Palette

创建技法、章节挂载、快捷键和验证步骤统一见
[Command Palette 使用说明](COMMAND_PALETTE.md)。
