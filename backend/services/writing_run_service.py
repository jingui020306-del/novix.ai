from __future__ import annotations

import asyncio
import json
import re
import uuid

from storage.fs_store import now_iso
from services.token_usage import summarize_usage


class WritingRunService:
    """Coordinate existing chapter jobs; checkpoint only after a complete unit."""

    def __init__(self, manager) -> None:
        self.manager = manager
        self.store = manager.store
        self.tasks: dict[tuple[str, str], asyncio.Task] = {}

    def _path(self, run_id: str) -> str:
        return f'meta/writing_runs/{run_id}.json'

    def _save(self, project_id: str, run_id: str, **changes) -> dict:
        record = self.store.read_json(project_id, self._path(run_id)) or {}
        record.setdefault('run_id', run_id)
        record.update(changes, updated_at=now_iso())
        target = self.store._safe_path(project_id, self._path(run_id))
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(f'.{uuid.uuid4().hex}.tmp')
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(target)
        return record

    def get(self, project_id: str, run_id: str) -> dict:
        record = self.store.read_json(project_id, self._path(run_id))
        if record and record['status'] in {'running', 'pausing'} and (project_id, run_id) not in self.tasks:
            record = self._save(project_id, run_id, status='paused', message='服务已重新启动，可以从保存的位置继续。')
        if record:
            job_ids = list(dict.fromkeys([*(record.get('job_ids') or []), *([record['child_job_id']] if record.get('child_job_id') else [])]))
            calls = []
            for job_id in job_ids:
                calls.extend(self.store.read_json(project_id, self.manager._job_path(job_id)).get('usage_calls', []))
            record = {**record, 'usage': summarize_usage(calls)}
        return record

    def list(self, project_id: str) -> list[dict]:
        root = self.store._safe_path(project_id, 'meta/writing_runs')
        records = [self.get(project_id, path.stem) for path in root.glob('*.json')]
        return sorted(records, key=lambda row: row['updated_at'], reverse=True)

    def _units(self, project_id: str, body: dict) -> list[dict]:
        chapter_id = body['chapter_id']
        _, blueprint, _ = self.manager._validate_write_payload(project_id, body)
        scope = body.get('scope', 'chapter')
        if scope == 'beat':
            beats = [
                {'chapter_id': chapter_id, 'scene_index': i, 'beat_index': j if scene.get('beats') else None, 'append': True,
                 'label': str(beat.get('summary') or beat.get('title') or f'桥段 {len(scene.get("beats", []))}') if isinstance(beat, dict) else str(beat)}
                for i, scene in enumerate(blueprint['scene_plan'])
                for j, beat in enumerate(scene.get('beats') or [scene.get('purpose') or f'场景 {i + 1}'])
            ]
            start, end = body.get('start_beat', 0), body.get('end_beat')
            end = len(beats) - 1 if end is None else end
            if not 0 <= start <= end < len(beats):
                raise ValueError('桥段范围无效，请重新选择。')
            return beats[start:end + 1]
        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
        order = list(dict.fromkeys(chapter for chapter in order if chapter.strip()))
        plan = {}
        for path in self.store._safe_path(project_id, 'cards').glob('*.yaml'):
            card = self.store.read_yaml(project_id, f'cards/{path.name}')
            if card.get('type') != 'story':
                continue
            for row in card.get('payload', {}).get('chapter_plan', []) or []:
                if not isinstance(row, dict):
                    continue
                legacy_id = str(row.get('chapter') or '')
                planned_id = str(row.get('chapter_id') or (legacy_id if legacy_id in order or re.fullmatch(r'chapter_[\w-]+', legacy_id) else ''))
                if planned_id:
                    plan[planned_id] = row
                    if planned_id not in order:
                        order.append(planned_id)
        if scope == 'chapter':
            order = [chapter_id]
        elif scope == 'volume':
            volume = self.store.read_json(project_id, f'drafts/{chapter_id}.meta.json').get('volume_id', 'volume_default')
            order = [chapter for chapter in order if self.store.read_json(project_id, f'drafts/{chapter}.meta.json').get('volume_id', plan.get(chapter, {}).get('volume_id', 'volume_default')) == volume]
        elif scope == 'chapters':
            start, end = body.get('start_chapter') or chapter_id, body.get('end_chapter') or (order[-1] if order else '')
            if start not in order or end not in order or order.index(start) > order.index(end):
                raise ValueError('章节范围无效，请先创建章节或填写章节计划。')
            order = order[order.index(start):order.index(end) + 1]
        if not order:
            raise ValueError('还没有可生成的章节，请先创建章节或填写章节计划。')
        units = []
        for chapter in order:
            if '/' in chapter or '\\' in chapter or chapter in {'.', '..'}:
                raise ValueError('章节编号无效。')
            meta = self.store.read_json(project_id, f'drafts/{chapter}.meta.json')
            units.append({'chapter_id': chapter, 'scene_index': 0, 'append': False, 'label': meta.get('title') or plan.get(chapter, {}).get('title') or chapter, 'plan': plan.get(chapter, {}), 'volume_id': meta.get('volume_id', 'volume_default')})
        return units

    async def create(self, project_id: str, body: dict) -> dict:
        if not self.store.read_yaml(project_id, 'project.yaml'):
            raise FileNotFoundError('项目不存在。')
        if any(record['status'] in {'running', 'pausing', 'paused'} for record in self.list(project_id)):
            raise ValueError('已有写作任务，请先继续或结束它。')
        units = self._units(project_id, body)
        run_id = f'run_{uuid.uuid4().hex[:10]}'
        self._save(project_id, run_id, status='running', next_index=0, units=units, request=body, child_job_id='', pause_requested=False, message='正在准备第一段。', created_at=now_iso())
        self._start(project_id, run_id)
        return self.get(project_id, run_id)

    def _start(self, project_id: str, run_id: str) -> None:
        key = (project_id, run_id)
        self.tasks[key] = asyncio.create_task(self._run(project_id, run_id))

    async def control(self, project_id: str, run_id: str, action: str) -> dict:
        record = self.get(project_id, run_id)
        if not record:
            raise FileNotFoundError('写作任务不存在。')
        if action == 'pause' and record['status'] == 'running':
            return self._save(project_id, run_id, pause_requested=True, status='pausing', message='当前章节或桥段完成后暂停。')
        if action == 'stop':
            if record['status'] in {'running', 'pausing'}:
                return self._save(project_id, run_id, stop_requested=True, status='pausing', message='当前段完成后结束任务，已生成的内容会保留。')
            return self._save(project_id, run_id, status='cancelled', message='已结束，生成的内容已保留。')
        if action == 'resume' and record['status'] in {'paused', 'failed'}:
            if (project_id, run_id) in self.tasks:
                raise ValueError('当前段仍在收尾，请稍后继续。')
            if any(other['run_id'] != run_id and other['status'] in {'running', 'pausing', 'paused'} for other in self.list(project_id)):
                raise ValueError('已有另一个写作任务，请先结束它。')
            if record.get('child_job_id') and record.get('active_index') == record['next_index']:
                child = self.manager.get_job(project_id, record['child_job_id'])
                draft_event = next((event for event in reversed(child.get('events', [])) if event.get('event') == 'WRITER_DRAFT'), None)
                expected = draft_event['data']['text'] if draft_event else record.get('unit_base', '')
                chapter = record['units'][record['next_index']]['chapter_id']
                if not record['request'].get('auto_apply_patch') and self.store.read_md(project_id, f'drafts/{chapter}.md') != expected:
                    raise ValueError('中断后正文已被修改，不能用旧断点覆盖；请结束此任务后重新生成。')
            self._save(project_id, run_id, status='running', pause_requested=False, stop_requested=False, message='从保存的位置继续。')
            self._start(project_id, run_id)
        return self.get(project_id, run_id)

    async def _run(self, project_id: str, run_id: str) -> None:
        try:
            while True:
                record = self.get(project_id, run_id)
                index = record['next_index']
                if index >= len(record['units']):
                    self._save(project_id, run_id, status='completed', message='已完成全部生成范围，草稿等待作者检查。')
                    return
                unit = record['units'][index]
                body = record['request']
                child_id = record.get('child_job_id', '')
                child = self.store.read_json(project_id, self.manager._job_path(child_id)) if child_id else {}
                if not child or child.get('status') != 'completed':
                    # shortcut: restart the interrupted unit, upgrade to provider-level
                    # continuation only when a provider supplies resumable requests.
                    latest_plan = unit.get('plan', {})
                    for file in self.store._safe_path(project_id, 'cards').glob('*.yaml'):
                        story = self.store.read_yaml(project_id, f'cards/{file.name}')
                        if story.get('type') == 'story':
                            latest_plan = next((row for row in story.get('payload', {}).get('chapter_plan', []) if isinstance(row, dict) and (row.get('chapter_id') or row.get('chapter')) == unit['chapter_id']), latest_plan)
                    latest_meta = self.store.read_json(project_id, f'drafts/{unit["chapter_id"]}.meta.json')
                    controls = {**body.get('generation_control', {})}
                    if latest_meta.get('writing_alignment'):
                        controls['writing_alignment'] = latest_meta['writing_alignment']
                        if latest_meta['writing_alignment'].get('scene_direction'):
                            controls['scene_direction'] = latest_meta['writing_alignment']['scene_direction']
                    unit_base = self.store.read_md(project_id, f'drafts/{unit["chapter_id"]}.md')
                    payload = {**body, 'chapter_id': unit['chapter_id'], 'scene_index': unit['scene_index'], 'generation_control': controls, 'constraints': {**body.get('constraints', {}), 'chapter_plan': latest_plan}, 'writing_run': unit}
                    if unit.get('append'):
                        base = record.get('append_base') if record.get('active_index') == index else None
                        payload['writing_run'] = {**unit, 'append_base': base if base is not None else self.store.read_md(project_id, f'drafts/{unit["chapter_id"]}.md')}
                    else:
                        meta = self.store.read_json(project_id, f'drafts/{unit["chapter_id"]}.meta.json')
                        if not meta:
                            self.store.write_json(project_id, f'drafts/{unit["chapter_id"]}.meta.json', {'chapter_id': unit['chapter_id'], 'title': unit['label'], 'volume_id': unit['volume_id']})
                        order = self.store.read_md(project_id, 'drafts/.chapter_order').splitlines()
                        if unit['chapter_id'] not in order:
                            self.store.write_md(project_id, 'drafts/.chapter_order', '\n'.join([*order, unit['chapter_id']]) + '\n')
                    child_id = await self.manager.run_write_job(project_id, payload)
                    self._save(project_id, run_id, child_job_id=child_id, job_ids=[*(record.get('job_ids') or []), child_id], active_index=index, unit_base=unit_base, append_base=payload['writing_run'].get('append_base'), message=f'正在写：{unit["label"]}')
                    while True:
                        child = self.store.read_json(project_id, self.manager._job_path(child_id))
                        if child.get('status') in {'completed', 'failed', 'cancelled'}:
                            break
                        await asyncio.sleep(0.2)
                if child.get('status') != 'completed':
                    self._save(project_id, run_id, status='failed', message=child.get('last_error') or '本段生成失败，可检查模型设置后继续；已完成部分会保留。')
                    return
                record = self.get(project_id, run_id)
                stop = body.get('stop_point', 'chapter')
                next_index = index + 1
                self._save(project_id, run_id, next_index=next_index, child_job_id='', active_index=None, append_base=None)
                if record.get('stop_requested'):
                    self._save(project_id, run_id, status='cancelled', message='已结束，生成的内容已保留。')
                    return
                if next_index < len(record['units']):
                    at_chapter_end = record['units'][next_index]['chapter_id'] != unit['chapter_id']
                    at_volume_end = record['units'][next_index].get('volume_id') != unit.get('volume_id')
                    risk = stop == 'risk' and any(mark.get('detection', {}).get('support_level') in {'unsupported', 'contradicted'} for mark in self.manager.evidence_service.list_marks(project_id, unit['chapter_id']))
                    if record.get('pause_requested') or stop == 'beat' or (stop == 'chapter' and at_chapter_end) or (stop == 'volume' and at_volume_end) or risk:
                        self._save(project_id, run_id, status='paused', message='已保存断点。检查草稿后，可以继续下一段。')
                        return
        except asyncio.CancelledError:
            self._save(project_id, run_id, status='paused', message='服务已停止，可以从保存的位置继续。')
            raise
        except Exception:
            self._save(project_id, run_id, status='failed', message='生成中断，请检查模型设置后继续。')
        finally:
            self.tasks.pop((project_id, run_id), None)
