# 本轮共享实施合同（2026-11-14 00:21，北京时间）

用户已明确授权附件及附带回复实施，沿用已发布的 `71cd186`，不是重新请求讨论确认。先完成首轮页面/代码检查，再按本合同并行。本文约定接口与文件边界，不代表实现或验证通过。

## 范围与存储边界

- 保留六个导航、现有冷纸深青视觉及已有数据；认知、信息披露、锁定都嵌入现有页面，不新建必填流程或独立资料库。
- cards 保存基础/共享对象，canon 保存追加阶段/控制历史，sessions 保存材料、指定修改及试写工作稿，drafts 保留正文/补丁。原布局、pipeline 顺序、旧客户端无锁时的行为保持。
- 必须在后端保护锁定资料。为避免 router、后台生成及服务直写绕过，root 将在 FSStore 既有写函数增加仅对已锁定正式目标生效的检查；这是本轮明确需求的必要依赖，不改变目录、无锁写入或追加历史语义。所有直接 replace/unlink 和批次 journal 也须预检。验收：普通保存、重导、旧 AI、alias、撤销/恢复均不能越过锁，指定修改只影响选定范围。
- 同一事件/信息继续回源；章节阅读顺序不改变人物经历。来源原文、人物说法、推断、AI 补全及作者修改分别记录，不用候选 new/supplement/conflict 冒充来源性质。

## 文件所有权

- 前端 Agent：`frontend/src/**`、必要 `DESIGN.md`。读 frontend-design / impeccable，context 已在会话运行，不重复；改界面前读 craft-floor。按现有页面减负，接下述真实 API。
- 后端 Agent：新信息/试写服务与 router、world_scope、author_data、ContextPack、Graph、shared_material、story_planning、scene_rehearsal、authoring_service、schemas、projects ZIP 和必要 evidence/check 服务。独占其 [精确信息合同](BACKEND_INFORMATION_CONTRACT.md)。不改 root 文件；接线请求发 root。
- root：`storage/fs_store.py` 的必要锁守护、新 `author_control_service.py` / router、`material_import_service.py` / router、cards/drafts/canon/analyze 等保存入口、main 注册/异常处理、manager 的 writer/reviewer 接线及邮件/最终整合。先沟通再转移文件，不并改。
- 体验审查/集成 Agent：`backend/tests/test_author_workflow.py` 的必要高风险回归、`docs/changes/**`、`docs/PRODUCT_PLAN.md`、`PRODUCT.md`。独立复核截图/代码和操作路径；产品问题交负责人修，不能以报告代替 root 最终实页。
- 所有 Agent 不改真实 data，不执行付费模型调用、不提交或发布。root 只用虚构 QA 和物理测试副本，核对本轮 320 资料基线，再统一提交发布。SSH 无写权限，已连接 GitHub 所有者 connector 可发布；须对照本地/远端 tree。

## 中央正式资料保护（root）

目标 `target` 为项目内原文件，例如 `cards/world_001.yaml`、`drafts/chapter_001.md`；界面显示作品/人物及字段名称，不显示路径。JSON 字段用 pointer，例如 `/payload/rules`，整条为 `/`；含 ID 的数组行可用 `@id` 段以稳定定位。不把文风旧 payload.locks 当成正式资料锁。

- GET `/api/projects/{p}/author-controls?target=...` 返回 `{target,revision,base_revision,locks:[{id,paths,reason,created_at}],history:[]}`。
- POST `/author-controls/lock`：`{targets:[{target,paths:["/payload/rules"],base_revision}],control_revision?,reason?}`。检查全部版本后一次确认；支持单字段、条目、批次。只锁保存版，不能将本地未保存稿标为正式版。控制历史追加 `canon/author_controls.jsonl`。
- POST `/author-controls/amendments`：`{target,paths,base_revision,control_revision?,reason}` → `{id,revision,status:"draft",target,paths,before,changes,base_revision,impacts}`。只创建 sessions 工作稿，原锁仍然有效。
- PUT `/author-controls/amendments/{id}`：`{revision,changes:{"/payload/rules":["新规则"]}}`。只允许选定路径，保留其他内容。
- POST `/author-controls/amendments/{id}/apply`：`{revision}`。重新核对原对象和控制版本，显示影响后作者确认；只合并指定修改，留前后版本、仍锁定，返回 `{status:"applied",value,base_revision,...}`。重复采用不再重写。
- POST `/author-controls/amendments/{id}/restore`：`{revision}`，仅恢复本次实际修改的路径；其后相同路径被修改时409，其他字段的新编辑保留，恢复也是有记录的新版本。
- Python `AuthorControlService(store).assert_write(project_id,target,before,after)`：普通写/删预检，锁冲突抛 `FileExistsError`（HTTP409），即使省略旧版本也不能绕过；无锁时不改变原行为。正式指定修改由该服务内部上下文仅授权选定目标/路径，不向客户端发通用解锁凭证。
- `assert_stage(project_id,entity_type,entity_id,changes,status)` 用于确认阶段：追加经历/认知不覆盖初始卡；涉及已锁定规则同字段的变化必须先指定修改核对，不借追加绕过。自然语言含义不由字符串匹配冒充可靠文学判断，检查必须给出来源与待核对项。
- 后端 Agent 的 trials.apply 遇锁409，在指定修改工作稿内采用；不接受任意客户端 edit_id 旁路。各页面统一通过指定修改入口，避免每个保存接口各造授权。

## 混合材料与指定补全（root）

复用原 material-imports，既有 `source` 作为第一份材料兼容，扩展 `sources[]`，每份有稳定 `id`、原文/文件、版本、范围。可向同一工作稿追加文字/链接/文件，多次添加不改变先前来源。

- POST `/material-imports/{id}/sources`：`{base_revision,text?|url?,reference_scope?}`；multipart `/{id}/sources/upload` 接 file、base_revision、reference_scope。复用 reader 的格式与真实限制，不能处理时明确失败。
- 候选增加 `provenance`（material_fact/character_statement/inference/ai_addition/author_edit）、`field_provenance` 及 evidence.source_id；原文可核验内容与 AI 补全分开。作者编辑已提取字段要保留原证据并标作者改动，不冒充逐字材料事实。
- POST `/material-imports/{id}/complete`：`{base_revision,target_ids:[candidate_id],paths:["rules"],instructions,keep_existing:true,mode:"faithful"|"adaptation",llm_profile_id?}`。只对选中的候选和字段提出可修改补全，保留原非空内容/别的字段；faithful 模式不能把无出处补全标成原作事实。返回原 batch 结构，只进入候选、不直接正式采用。
- 旧结果仍检查工作稿与原资料版本，主动 cancel/retry 沿用。锁只约束正式资料，候选可编辑；采用时有锁冲突明细，不能静默跳过或覆盖。
- 字段/条目/批次锁入口统一调用 author-controls；导入先正式采用，再由作者选择确认锁定，部分采用不要求整批锁。

## 信息、时期地区和试写（后端 Agent）

精确路径与字段以 [BACKEND_INFORMATION_CONTRACT.md](BACKEND_INFORMATION_CONTRACT.md) 为准：information-items 唯一共享主记录、typed canon records、reader 阅读轴、information-state、带依据签名的 review-decisions，以及 sessions/trials。该合同中的 `edit_id` 占位不构成解锁授权，按上节遇锁转指定修改。

- world_context 增 period_id / region_ids / overrides，时期/地区选项必须回原条目；局部改编只存故事差异，不改共享世界。时间/分支/地域分别过滤。
- 同源信息在人物经历/变化、场景/工作表、伏笔/章节计划、正文/右材料栏就地显示摘要与跳转。只记录关键秘密/透露，不要求每句台词做表。
- writer 有限视角读取适用认知，不得到被误信替换后的作者真相；reviewer 分别审真相、角色表达、认知和已披露，保留有意欺瞒/不可靠叙述，不自动解释秘密。
- ZIP 继续复用旧系统，修复 `.chapter_order` 丢失，保留来源、阶段、控制历史；恢复旧运行任务不得自动继续调用模型。

## 验收与交付

必要回归复用已有测试，只为新风险补少量集中用例。完整默认 pytest 在物理 backend 副本运行，不能让 main 的固定 DATA_DIR 接触真实资料。65 项为上一轮基线，本轮通过数以最终执行为准。

需用虚构完整案例验证：混合不完整材料提取/补全/作者修订/部分确认锁定/重导拒绝；世界时期地区分支与局部改编；A 偷钥匙指认 C、B 听到且误信、读者已见不同信息；移动序章只改变阅读披露；有意安排依据未变不反复报、改动后重新核对；试写放弃不污染正式资料、采用受锁与版本保护；指定修改与恢复不改未选内容；ZIP 往返、保存失败、读取失败、旧 AI、多标签与长内容布局。root 最终重新实看全部页面及关键展开/弹窗/空态，保留前后截图与明确限制。

每30分钟邮件仅由 root/本聊天 heartbeat 使用已连接 Gmail 发至用户指定地址，附件仅虚构作品截图。发送记录在本轮 .venv 目录；完成后暂停提醒，不将私密材料或邮件状态混进产品数据。
