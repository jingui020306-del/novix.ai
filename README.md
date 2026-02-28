# novix.ai - AI 长篇小说工作台（Phase 1 Mock）

## 启动
- Linux/macOS: `./start.sh`
- Windows: `start.bat`

## 后端测试
```bash
cd backend
python -m pytest -q
```

## 数据目录（WenShape immutable）
```
data/{project_id}/
  project.yaml
  cards/
  canon/
  drafts/
  sessions/
```

## Demo
后端启动会自动初始化 `data/demo_project_001/`，用于演示角色、蓝图、章节、canon 的写-评-改-合并闭环。
