# novix.ai - AI 长篇小说工作台（Phase 2）

## 启动
- Linux/macOS: `./start.sh`
- Windows: `start.bat`

## 后端测试
```bash
cd backend
python -m pytest -q
```

## WenShape 主结构（不可变）
```
data/{project_id}/
  project.yaml
  cards/
  canon/
  drafts/
  sessions/
```

## Phase2 新增（可重建扩展）
- `assets/style_samples`：上传文风样本 txt/md。
- `meta/kb/kb_style`：chunks + bm25 索引。
- `meta/summaries`：style profile、章节摘要副本。

## UI 使用：文风样本上传并全书模仿
1. 启动后进入 **Style Studio**。
2. 粘贴样本文本并上传（`kind=style_sample`）。
3. 点击“分析文风”生成 style guide（写回 `cards/style_001.yaml`）。
4. 进入 ChapterEditor 点击“生成本章”。
5. 到 Context Panel 查看 `style_guide`、style examples、dropped/compression 信息。

## 重建 KB 索引
```bash
curl -X POST http://localhost:8000/api/projects/demo_project_001/kb/reindex \
  -H 'content-type: application/json' \
  -d '{"kb_id":"kb_style"}'
```

## 查看 context_manifest 与摘要
- Job 事件流会输出 `CONTEXT_MANIFEST`。
- 章节摘要写入：
  - `drafts/chapter_001.meta.json` (`chapter_summary` / `scene_summaries`)
  - `canon/facts.jsonl`（`scope=chapter_summary|scene_summary`）
