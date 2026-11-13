# 作者工作台共享契约（2026-11-13 22:30，北京时间）

用户已确认原12项与补充13–23项，允许三线并行及验证后的提交推送。本契约先于Agent实施约定；不得把待实现内容记为已验证。

## 资料归属与保护

- 保留现有WenShape目录、cards初始设定、canon追加动态事实、drafts正文与追加补丁、sessions工作稿/操作记录；不增数据库或第二套权威存储。
- 世界/人物/关系共享数据仅有一份来源。事件以原owner卡和scene_id定位，标题不充当身份。重复来源须保留来源映射和冲突，不能仅隐藏同名节点。
- 场景安排主要在章节正文编辑；工作表引用同一事件下的既有rehearsal，不复制记录。无分章事件仍可打开同一场景编辑器。
- 当前编辑、已保存、AI候选、确认采用明确区分。骨架可反复保存和修改；无强制创作步骤。
- 读取适用于故事分支、发生时间、人物认知的已确认内容；未来计划单列。名称修正与事件中的改名区分，正文历史称谓不批量替换。

## 通用版本

卡片GET/list响应附加`_revision`（文件内容SHA256，未创建为空）；保存携带`_revision`，后端检查后移除此传输字段再落盘。旧客户端省略时保持原兼容行为；新前端所有卡片保存必须携带。正文GET/保存使用`revision`/`base_revision`，章节meta同卡片`_revision`。过期返回409中文信息，保留作者本地草稿；失败不标已保存。root负责公共版本助手和写入入口。

## 时间、分支和世界

故事`payload.world_context`、章节meta或事件行的可选`world_context`：

```json
{"world_id":"world_001","branch_id":"main","time":{"year":2026,"event_ref":{"owner_card_id":"outline_001","scene_id":"event_1"},"position":"immediate_after","phase":""},"base_setting_ids":[],"local_adjustments":""}
```

- 字段全可选，旧资料不被填默认年份。`position`为before/immediate_after/phase；phase需明确阶段说明，不能把任意后续状态当成刚结束。
- 继承顺序事件/场景→章节→故事；返回`inherited_from`和不确定项。故事线是并行线索；事件分支另有branch_id、parent_branch_id、fork_event_ref。主线默认main，无分支不展示复杂管理器。
- 分支只共享分歧前确认历史；已知事实、人物认知、状态与世界规则都受范围限制。未知时间不猜年龄或强行采用最近状态。
- GET `/api/projects/{p}/author-state?story_card_id=&chapter_id=&event_ref=&branch_id=`返回scope、inherited_from、characters、worlds、relations、events、branches、warnings、sources。单人物GET `/characters/{id}/state`返回base/state/knowledge/age/changes/scope/sources/uncertainties。后端Agent负责补充精确响应例子通知前端。

## 共享关系和事件接口（后端Agent）

- `/relationships` GET返回关系列表，POST创建；`/relationships/{id}` GET/PUT读取编辑同一条，PUT body含`_revision`。记录含id、label、participants[{entity_id,role,address_as?}]、direction、notes、scope、stages、sources。多人共享关系不展开为独立两两复制；一次共同经历属于事件。
- 静态共享关系可放既有outline卡的专用registry中；动态阶段/人物状态/认知写canon追加记录。旧人物卡关系仍回源兼容，返回owner_card_id/owner_path，不无确认迁移或删旧数据。
- `/events` GET聚合原事件，返回稳定id、owner_card_id、scene_id、values、sources、aliases/duplicate_conflicts；相同标题不合并。PUT `/events/{owner}/{scene}`用values及base_revision更新唯一原行。
- `/characters/{id}/stages` GET/POST阶段记录，`/worlds/{id}/stages`同理；记录scope、status(planned/confirmed)、changes、knowledge、source。`/worlds/{id}/branches` GET/PUT维护分支，校验分歧点与环路。
- 知识图沿用原接口和字段，扩展关系节点/参与者和图层。默认人物关系在前端选择；资料引用是可选图层，catalog仍可访问所有节点。

## 统一材料导入（root）

- `/material-imports` POST {text?,url?,purpose:story/world/relations/style,story_card_id?,world_context?,reference_scope?}；multipart `/material-imports/upload`接收file、purpose及story_card_id。
- `/material-imports/{id}` GET工作稿；PUT {base_revision,cleaned_text?,skeleton?,candidates?}保存；`/{id}/extract` POST {base_revision,use_ai,llm_profile_id?}主动提取；`/{id}/apply` POST {base_revision,selected_ids,decisions?}；`/{id}/undo`、`/{id}/cancel` POST。
- 响应含id、revision、status、purpose、source{original_text,text,url,filename,fetched_at,version,coverage,warnings}、cleaned_text、skeleton、candidates、base_versions、usage、warnings。候选{id,kind,classification:new/supplement/conflict,target_id?,values,evidence:[{quote,page?,...}],scope?,selected,decision?}。
- 通过`/{id}/source` GET回看原图/文件。保留原材料版本、成功读取范围、作者指定版本/条目/章节/范围；登录或部分读取明确标记，不从标题冒充全文。
- 本地文字提取、去重、映射、版本检查、批次应用不用模型。PDF/Word优先复用本机工具；图片/扫描件需明确视觉模型和候选确认。AI新创作不混入原文事实。世界人物台词、传闻不自动成为基础规则。
- 批次工作稿在sessions内。跨文件操作先记录变更/版本，整批完成再发布；失败恢复可重试，同批幂等。撤销只撤本批未被后来修改的内容，canon以补偿记录撤销。不整篇覆盖作者新编辑。
- 文风`/style/analyze`返回candidate、evidence、source_versions、base_revision，作者确认后走卡片保存；不再把无样本固定文风写回卡片。

## 工作表与前端

保留情节梗概、角色交集、人物故事线、十五节拍详表/同源简表、章节与线索视图。表格默认显示；材料、骨架与事件图按需展开；列选择持久化、单格AI按焦点显示。作品设定：世界总览→地图与地点→人物与组织→文风。人物先总览和关系，再打开资料；创建独立。正文编辑器优先，场景、资料、检查收起/侧栏；材料面板随页面范围。文学技法日常入口集中正文，旧数据不删。

## 文件所有权与集成

- 前端Agent独占frontend/src/**、必要DESIGN.md；frontend-design/impeccable沿用既有视觉，context已在本会话运行，不重复；编辑前读craft-floor。
- 后端Agent独占shared_material_service、knowledge_graph_service、story_planning_service、context_pack_service、scene_rehearsal_service、authoring_service、routers/authoring.py、schemas及新world_scope/author_data服务与关联router。不得改root入口，新增router发消息由root注册。
- root独占routers/cards.py、drafts.py、uploads.py、style.py、main.py、services/change_suggestion_service.py、style_service.py、新import/version服务和router，以及必要jobs/manager.py调用接线。保持pipeline顺序，时间范围取材接在原上下文阶段，接受条件为分支/倒叙/知识隔离验证通过。
- 修改记录/验证Agent独占docs/changes、docs/PRODUCT_PLAN、PRODUCT.md及必要backend/tests新高风险验证；可以读全部代码，不修改前后端产品实现，报告失败给对应负责人。根契约修改需先沟通，最终集成由root完成。
- 所有Agent不执行git提交推送或付费模型调用、不改真实data。各自在临时store验证；root最终回归/真实浏览器/资料哈希/差异审核及提交推送。
