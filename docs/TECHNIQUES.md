# Technique System

## 作者怎么用

技法库不是资料百科，而是章节写作时可以挂载的工具。

作者可以把技法分成三类来用：

- 叙事技巧：悬念、误导、反转、对照、潜台词、冲突升级、延迟满足。
- 场景技巧：开场钩子、爆点配方、人物对峙、压迫推进、情绪张力、场景转折。
- 检查工具：小说问题检查、人物小传、大纲调研、时间线检查、场景一致性、伏笔追踪。

每张技法卡最好包含：

- 适合什么时候用；
- 不适合什么时候用；
- 本章怎么用；
- 正文里应该出现什么可见信号；
- 常见过量风险；
- AI 写作或改写时要遵守的步骤；
- 检查标准。

章节页右侧会显示本章挂载的技法。绿色点亮只代表正文里找到了可回查 quote；AI 自己说“用了这个技法”不算。

## 推荐技法卡字段

```json
{
  "description": "技法的写作目的",
  "usage_layer": "structure | narrative | description | character | expression | recipe",
  "suitable_scenes": ["适合的场景"],
  "unsuitable_scenes": ["不适合的场景"],
  "apply_steps": ["执行步骤"],
  "signals": ["正文里可见的判断信号"],
  "overuse_risks": ["过量风险"],
  "do_dont": {
    "do": ["应该这样做"],
    "dont": ["不要这样做"]
  },
  "intensity_levels": {
    "low": "轻度使用",
    "med": "正常使用",
    "high": "作为本场主设计"
  }
}
```

## 作者工作流

1. 在 **技法库** 搜索技法。
2. 在章节右侧或命令面板把技法挂到当前章。
3. 写作共识里说明这一章为什么需要它。
4. 点击 **按共识生成**。
5. 生成后点击 **检查要求**。
6. 只有正文里出现 quote 和行号时，技法才会点亮。
7. 如果未点亮，可以让 AI 改写选区，或作者手动补写。

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

- 创建技法：
  - `+ technique 冷笔触`
  - `+ technique "平行蒙太奇" --category 结构艺术 --signal "镜头并置" --step "交错切换"`
- 章节挂载：
  - `pin technique 蒙太奇 high --weight 1.6 --note "开头强切换"`
  - `unpin technique 蒙太奇`
  - `list pinned techniques`

## 手动验收

1. 打开 `chapter_001`。
2. 执行 `pin technique 蒙太奇 high`。
3. 确认 `pinned_techniques` 更新。
4. 执行 `+ technique 冷笔触`。
5. 在 Techniques 面板看到新卡并可编辑。
6. 运行写作任务后检查 `TECHNIQUE_BRIEF` 与 manifest fixed block。
