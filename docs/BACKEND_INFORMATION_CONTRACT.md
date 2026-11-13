# 世界材料、信息边界与试写：后端接口合同

本文件为本轮前后端共享合同。状态：主合同已放行，实施中；不能据接口约定声称验证通过。沿用 WenShape、现有资料页、同源事件、版本守护和 canon 追加历史，不新建独立导航或数据库。

## 既有能力与必要补充

复用材料导入工作稿及分配 journal、`outline_author_registry` 共享对象、`author_stages.jsonl` 动态阶段、`WorldScopeService`、`ContextPackService`、正文 patch/diff/snapshot 和项目 ZIP 备份恢复。补充多来源与指定补全、正式资料的后端锁、时期/地区/局部改动、信息表达/认知/披露、有意安排与试写。

中央锁、材料导入和统一保存守护由 root 实施。以下新写入接口均调用同一中央锁；遇锁进入 `author-controls/amendments` 指定修改，不提供通用解锁 token。省略旧版本字段可保持旧客户端兼容，但不能绕过正式锁。

## 一个信息对象，多种关联

主记录唯一保存在：

`cards/outline_author_registry.yaml#payload.information_registry`

```json
{
  "id": "information_key",
  "label": "钥匙去向",
  "truth_status": "undecided",
  "truth_value": null,
  "fact_ref": null,
  "scope": {"world_id": "world_1", "branch_id": "main"},
  "sources": [{"path": "cards/story_1.yaml", "quote": "作者原材料"}],
  "_revision": "registry文件SHA256"
}
```

- GET/POST `/api/projects/{p}/information-items`；GET/PUT `/information-items/{id}`。PUT 携带 `_revision`，过期409。新增内容只维护一个信息 ID，各页引用它。
- 卡片 `payload.information_ids`、事件行 `information_ids`、章节 meta `information_ids` 引用该 ID；已有表达/认知记录也可直接关联出场人物，取材不要求重复填同一秘密。
- 有 `fact_ref` 时真相从原 canon 事实读取，不复制一份 `truth_value`。未决定就保留 null，不能补成确定事实。
- “作者确定的真相”不自动等于“当前已经发生”或“某人物知道”。

动态记录复用 `canon/author_stages.jsonl`，不回写人物初始卡：

GET/POST `/information-items/{id}/records`，POST 示例：

```json
{
  "record_type": "awareness",
  "status": "confirmed",
  "scope": {
    "world_id": "world_1", "branch_id": "main",
    "time": {"event_ref": {"owner_card_id": "story_1", "scene_id": "key_lost"}, "position": "immediate_after"}
  },
  "data": {"character_id": "B", "state": "believes", "value": "C拿走了钥匙", "basis": "被A告知", "expression_ref": "stage_expression"},
  "source": {"kind": "author", "note": "作者确认的剧情安排"}
}
```

响应追加记录 `{id, entity_type:"information", entity_id, record_type, status, scope, data, source, _revision}`。记录类型与 data：

| record_type | data |
| --- | --- |
| occurrence | `value`、可选 `event_ref`，代表发生情况 |
| expression | `speaker_id`、`audience_ids`、`heard_by`、`value`、可选 `intent`，意图可为 statement/lie/conceal/uncertain |
| awareness | `character_id`、`state`、`value`、`basis`、可选 `expression_ref`；state 为 knows/believes/suspects/misunderstands/conceals |
| reader_disclosure | `chapter_id`、`start`、`end`、`mode`、`value`、`source_revision`；mode 为 shown/hint/claim |

`planned` 与 `confirmed` 分开。表达和认知按故事发生时间筛选；读者记录按实际章节/段落顺序筛选，正文改动后旧证据须标待核对。听见不等于相信，相信不等于真相；旧知识条目继续兼容，不在无依据时自动补类型。

GET `/information-state?chapter_id=&event_ref=&pov_character_id=&reader_chapter_id=&reader_offset=` 返回 `{scope,items:[{...信息,occurrences,expressions,awareness,reader_disclosures}],warnings,sources}`。用于既有右侧材料栏、人物成长、事件和事实详情。有限视角的 writer 只能得到其适用认知值，不能把 B 的误信替换为作者真相；reviewer 可分别核对真相、表达与已披露边界。

认知历史仍在原记录中，当前适用记录标 `current:true`，旧记录为 false，无法确认先后为 uncertain。原人物阶段的 `knowledge` 继续兼容，显式 state 保留其知道/相信/怀疑等性质，不按文字相似性迁移或合并。

## 世界选择与局部改动

扩现有 `world_context`：`period_id?`、`region_ids?:string[]`、`overrides?:[{target_id,path:string[],base_revision,before,after}]`；现有 `local_adjustments` 文字保留。

- 时期选项来自既有 world 条目 `entry_type=period/history` 及世界阶段；地区来自 `entry_type=place/region`，按适用世界筛选，返回原 ID、名称和来源。
- GET `/worlds/{id}/context-options` 返回 `{world_id,periods,regions,branches}`；author-state 也返回这些选项。
- `period_id` 引用条目或已存在阶段的 ID，不能凭标签猜同一对象。
- 默认将 overrides 保存于故事范围，保留原设定与改动，不复制世界、不写共享世界。更新共享世界必须显式走中央指定修改与确认。
- 事件→章节→故事继承保持；`branch_id` 不是故事线，阅读顺序不是事件时钟。

## 有意安排

POST `/information-items/{id}/review-decisions`：

```json
{"action":"intentional","chapter_id":"chapter_1","actor_ids":["A","B"],"reason":"A故意误导B","quote":"是C拿走了钥匙","source_versions":{"drafts/chapter_1.md":"SHA256"}}
```

action 为 intentional/correct/defer；响应 `{id,action,signature,status:"active",sources}`。保留信息、人物、位置和依据签名；依据改变时变为 stale，不能作为无限期、全书忽略开关。沿用原材料与检查反馈位置，不另开页面。

GET `/information-items/{id}/review-decisions?chapter_id=` 返回当前处理决定；相同绑定的新决定追加并取代旧决定，原记录保留。Evidence 风险只在明确的信息/原事实 ID 或选定原句匹配时应用有效决定，不猜测整章或全书的意图。

新建反馈的正文原句必须唯一，后端返回派生的 `quote_source`；签名绑定所在完整段落和段序，不因本章其他末段改写而失效。该决定仅应用于该段落的明确风险；同句出现多处时要求扩大引用。旧记录缺少定位依据时保留原有整篇版本守护，不擅自把新稿认作旧依据。

锁定已确认且引用 `fact_ref` 的真相，会同批保护原事实的 `value`，普通 `canon/revisions` 追加不能绕过。事实指定修改仍使用 `/author-controls/amendments`，`target="canon/facts.jsonl"`、`paths=["/@事实ID/value"]`，以 GET controls 返回的 `base_revision` 同时校验事实与修订；采用和恢复只追加原 `canon/revisions.jsonl`，不改原事实历史。指定修改共享信息仍执行信息字段校验；`truth_status` 未确认时残留的编辑候选不作为真相取材。

## 试写

- POST `/chapters/{chapter_id}/trials` `{text?,instructions?,scope?,start?,end?}` → `{id,revision,status:"draft",text,base_revision,source_versions,target_range}`。
- GET/PUT `/trials/{id}`；PUT `{revision,text,instructions?}`。
- POST `/trials/{id}/generate` `{revision,llm_profile_id?,instructions?}`，只产生试写候选。
- POST `/trials/{id}/apply` `{revision}`，再次检查源版本及正式锁后，沿原 `apply_revision` 生成 patch/diff/snapshot；锁冲突409转指定修改。
- POST `/trials/{id}/discard` `{revision}`，正式资料不变。

试写只存 `sessions` 工作稿，不运行会改正式正文/canon 的写入分支。不自动将试写发展变成正式事实、人物状态或披露。采用后的关联核对仍保留候选与作者确认。

试写生成禁用普通 complete 的摘要预处理，避免改变正式 meta；采用成功创建原体系 `source=author_trial` 待审记录并返回 review_id/review_required，不增加模型调用。

## 导出恢复和验收

沿用 `/projects/{p}/export.zip` 与 `/projects/import.zip`；必须保留正文、卡片、来源、同源关联、canon 阶段、锁状态与权威 `drafts/.chapter_order`。恢复不自动继续旧运行中的模型任务，不借恢复绕过锁。阅读顺序变化不重写人物阶段。

验收使用临时 FSStore/假网关：A 偷钥匙、对 B 指认 C、B 只相信指认、读者已经看见 A 的案例；章节换序只改变披露；有意安排签名失效；局部世界改动与其他世界隔离；试写保存/生成/放弃不改正式资料，采用时锁/版本冲突409；完整 ZIP 往返保留这些关系与锁。真实模型质量和自然语言矛盾识别准确率须如实列为未实测。

## 后端实施状态

上述后端读写与取材接口已落盘，等待主 agent 完整副本回归和实页集成。当前集中测试为37项通过（包含上一轮25项和本轮已新增高风险用例），仅使用临时 FSStore/假网关，不等于真实模型质量或全站验收已完成。

新增 `information_service.py`、`trial_service.py` 及相应 router；修改集中于既有 author_data/world_scope/ContextPack/Graph/authoring/shared_material/evidence、schema 和项目 ZIP 路由。主合同要求的中央锁、混合材料、manager/main 接线由 root 持有；本文件不代替最终全量验证记录。
