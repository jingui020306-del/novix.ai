# Technique System

## 分类体系

技法库由 `technique_category` 与 `technique` 两类卡片组成，均存放在 `data/{project_id}/cards/*.yaml`。

顶层分类：

1. 表达手法
2. 修辞手法
3. 结构手法
4. 描写方法
5. 表现手法

## 挂载规则

- `outline.payload.technique_prefs[]`：支持 `scope=arc|chapter|beat`。
- `drafts/chapter_xxx.meta.json.pinned_techniques[]`：本章固定技法。
- 合并时同 `technique_id` 由 chapter pinned 覆盖 outline 配置（强度与备注优先）。

## Pipeline 接入

- 事件顺序中在 `DIRECTOR_PLAN` 后新增 `TECHNIQUE_BRIEF`。
- `CONTEXT_MANIFEST.fixed_blocks` 会固定注入：
  - `technique_brief`
  - `technique_checklist`
  - `technique_style_constraints`（有指标时）
- 超预算时仅压缩 brief 的示例段，保留 checklist 与 must-have signals。

## 操作示例

1. 在 Techniques 面板维护分类卡与技法卡。
2. 在 Context 区的 Outline Technique Mount 写入 `technique_prefs`。
3. 在 Chapter Editor 的 Chapter Techniques 设置 `pinned_techniques`。
4. 运行写作任务后查看 `TECHNIQUE_BRIEF` 事件与清单。
5. 审稿阶段会产出 `type=technique_adherence` 的问题项，并在编辑阶段优先给出最小修复补丁。

## 生成脚本

- 脚本：`scripts/generate_technique_library.py`
- 默认会生成 5 个分类卡与至少 120 张技法卡到 `data/demo_project_001/cards/`。
