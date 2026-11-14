from __future__ import annotations

import asyncio
import json
import uuid
from difflib import unified_diff

from services.author_data_service import AuthorDataService
from services.context_pack_service import ContextPackService
from services.edit_version_service import check_revision, revision
from services.information_service import InformationService
from services.knowledge_graph_service import KnowledgeGraphService
from services.token_usage import summarize_usage
from services.world_scope_service import WorldScopeService, entity_id
from storage.fs_store import now_iso


BOOT_ID = uuid.uuid4().hex
ACTIVE = {}


class TrialService:
    """Disposable text in sessions; only explicit adoption uses the normal manuscript writer."""

    def __init__(self, store, authoring=None):
        self.store, self.authoring = store, authoring

    def _lock(self, project_id):
        return AuthorDataService(self.store)._lock(project_id)

    def _path(self, trial_id):
        return f'sessions/trials/{entity_id(trial_id, "试写")}.json'

    def _save(self, project_id, value):
        path = self.store._safe_path(project_id, self._path(value['id']))
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f'.{uuid.uuid4().hex}.tmp')
        try:
            temporary.write_text(json.dumps({**value, 'updated_at': now_iso()}, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        return {**self.store.read_json(project_id, self._path(value['id'])), 'revision': revision(self.store, project_id, self._path(value['id']))}

    def get(self, project_id, trial_id):
        value = self.store.read_json(project_id, self._path(trial_id))
        if not value:
            raise FileNotFoundError('这份试写不存在。')
        if value.get('status') == 'generating' and value.get('boot_id') != BOOT_ID:
            value.update(status='needs_retry', error='服务曾中断；试写已保留，请手动重试，不会自动调用模型。')
            return self._save(project_id, value)
        return {**value, 'revision': revision(self.store, project_id, self._path(trial_id))}

    def list(self, project_id, chapter_id):
        entity_id(chapter_id, '章节')
        return [self.get(project_id, path.stem) for path in sorted(self.store._safe_path(project_id, 'sessions/trials').glob('*.json'))
                if self.store.read_json(project_id, f'sessions/trials/{path.name}').get('chapter_id') == chapter_id]

    def create(self, project_id, chapter_id, body):
        entity_id(chapter_id, '章节')
        with self._lock(project_id):
            source = self.store.read_md(project_id, f'drafts/{chapter_id}.md')
            start, end = body.get('start', 0), body.get('end', len(source))
            if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or not 0 <= start <= end <= len(source):
                raise ValueError('请选择当前已保存正文中的试写范围。')
            text = body.get('text', source[start:end])
            if not isinstance(text, str) or len(text) > 100000 or not isinstance(body.get('instructions', ''), str):
                raise ValueError('试写内容须为10万字以内的文字。')
            resolved = WorldScopeService(self.store).resolve(project_id, chapter_id=chapter_id, world_context=body.get('scope'), event_ref=body.get('event_ref'), story_card_id=body.get('story_card_id'))
            return self._save(project_id, {'id': f'trial_{uuid.uuid4().hex[:14]}', 'chapter_id': chapter_id, 'status': 'draft',
                'text': text, 'instructions': body.get('instructions', ''), 'source_text': source, 'scope': resolved['scope'],
                'narrative_pov': resolved.get('narrative_pov', ''), 'target_range': {'start': start, 'end': end},
                'base_revision': revision(self.store, project_id, f'drafts/{chapter_id}.md'),
                'source_versions': {f'drafts/{chapter_id}.md': revision(self.store, project_id, f'drafts/{chapter_id}.md')},
                'usage_calls': [], 'usage': summarize_usage([]), 'created_at': now_iso()})

    def update(self, project_id, trial_id, body):
        with self._lock(project_id):
            check_revision(self.store, project_id, self._path(trial_id), body.get('revision', ''))
            value = self.get(project_id, trial_id)
            if value['status'] in {'applied', 'discarded'}:
                raise ValueError('已采用或放弃的试写不能覆盖；请另建试写。')
            if not isinstance(body.get('text'), str) or len(body['text']) > 100000:
                raise ValueError('试写内容须为10万字以内的文字。')
            value.update(text=body['text'], instructions=body.get('instructions', value.get('instructions', '')), status='draft', error='')
            value.pop('revision', None)
            return self._save(project_id, value)

    async def generate(self, project_id, trial_id, body):
        tokens = body.get('max_tokens', 2400)
        if not isinstance(tokens, int) or isinstance(tokens, bool) or not 128 <= tokens <= 16000:
            raise ValueError('试写输出范围须为128至16000。')
        if not isinstance(body.get('instructions', ''), str) or len(body.get('instructions', '')) > 6000:
            raise ValueError('试写要求须为6000字以内的文字。')
        with self._lock(project_id):
            check_revision(self.store, project_id, self._path(trial_id), body.get('revision', ''))
            value = self.get(project_id, trial_id)
            if value['status'] in {'applied', 'discarded', 'generating'}:
                raise ValueError('这份试写正在生成或已经结束，请先查看当前状态。')
            check_revision(self.store, project_id, f"drafts/{value['chapter_id']}.md", value['base_revision'])
            if not self.authoring:
                raise ValueError('尚未配置试写模型；仍可手写、编辑和放弃试写。')
            value.pop('revision', None)
            value.update(status='generating', boot_id=BOOT_ID, error='')
            started = self._save(project_id, value)
            expected = started['revision']
        key, current_task = (str(self.store._project_dir(project_id)), trial_id), asyncio.current_task()
        ACTIVE[key] = current_task
        calls = []
        try:
            scope, chapter = value['scope'], value['chapter_id']
            from services.prose_strategy_service import prose_guidance
            direction = body.get('scene_direction') or self.store.read_json(project_id, f'drafts/{chapter}.meta.json').get('writing_alignment', {}).get('scene_direction', {})
            guidance = prose_guidance(direction)
            linked = KnowledgeGraphService(self.store).materials(project_id, chapter, {'world_context': scope}, world_context=scope, scene_ref=scope.get('event_ref'), max_chars=8000)
            materials = InformationService(self.store).materials(project_id, scope, max_chars=4000)
            manifest = {'author_scope': {'scope': scope, 'narrative_pov': value.get('narrative_pov', ''), 'sources': [], 'warnings': []},
                'linked_materials': linked, 'generation_control': {'world_context': scope}, 'information_materials': materials}
            prompt, report = ContextPackService(self.store).build(project_id, chapter, manifest, {'作者试写要求': body.get('instructions', value.get('instructions', '')),
                '小说观察顺序': guidance, '原选区（只作参考）': value['source_text'][value['target_range']['start']:value['target_range']['end']], '当前试写稿': value['text'], '场景': {}}, max_chars=18000)
            if len(prompt) > 19000:
                raise ValueError('本次试写材料过长，请缩小范围。')
            text = await self.authoring.complete(project_id, body, 'chapter_writer',
                '你是小说试写合作者。只输出试写正文，不输出说明。仅在作者指定范围内探索另一种写法或发展，事实、表达、认知与读者信息分开。'
                '人的误信不变成作者真相，不提前解释秘密；保留文风、视角和未改动的底线。新发展只是试写候选，不是正式事实。',
                prompt, max_tokens=body.get('max_tokens', 2400), usage_callback=calls.append, prepare_memory=False)
            with self._lock(project_id):
                check_revision(self.store, project_id, self._path(trial_id), expected)
                if not ContextPackService(self.store).sources_unchanged(project_id, report['source_versions']):
                    raise FileExistsError('试写期间依据已变化，原文和当前试写保留，请用最新材料重试。')
                value.update(status='draft', text=text, source_versions=report['source_versions'], usage_calls=[*value['usage_calls'], *calls])
                value['usage'] = summarize_usage(value['usage_calls'])
                value['diff'] = '\n'.join(unified_diff(value['source_text'][value['target_range']['start']:value['target_range']['end']].splitlines(), text.splitlines(), fromfile='原选区', tofile='试写', lineterm=''))
                return self._save(project_id, value)
        except BaseException as exc:
            with self._lock(project_id):
                current = self.get(project_id, trial_id)
                current.pop('revision', None)
                current['usage_calls'] = [*current.get('usage_calls', []), *calls]
                current['usage'] = summarize_usage(current['usage_calls'])
                if revision(self.store, project_id, self._path(trial_id)) == expected:
                    current.update(status='failed', error='试写已取消，内容保留。' if isinstance(exc, asyncio.CancelledError) else str(exc))
                self._save(project_id, current)
            if isinstance(exc, asyncio.CancelledError):
                raise ValueError('试写已取消，正式资料保持原样。') from exc
            raise
        finally:
            if ACTIVE.get(key) is current_task:
                ACTIVE.pop(key, None)

    def apply(self, project_id, trial_id, body):
        from services.author_control_service import AuthorControlService
        with self._lock(project_id):
            value = self.get(project_id, trial_id)
            if value['status'] == 'applied':
                return value
            check_revision(self.store, project_id, self._path(trial_id), body.get('revision', ''))
            if value['status'] not in {'draft', 'failed', 'needs_retry'} or not value['text'].strip():
                raise ValueError('请先完成并核对试写内容，再采用。')
            if not self.authoring:
                raise ValueError('正文采用服务尚未就绪。')
            path = f"drafts/{value['chapter_id']}.md"
            check_revision(self.store, project_id, path, value['base_revision'])
            if not ContextPackService(self.store).sources_unchanged(project_id, value['source_versions']):
                raise FileExistsError('试写依据或正文已有新修改，请重新核对，不能覆盖。')
            start, end = value['target_range']['start'], value['target_range']['end']
            merged = value['source_text'][:start] + value['text'] + value['source_text'][end:]
            AuthorControlService(self.store).assert_write(project_id, path, value['source_text'], merged)
            result = self.authoring.apply_revision(project_id, value['chapter_id'], {'source_text': value['source_text'], 'start': start, 'end': end,
                'text': value['text'], 'base_hash': self.authoring.content_hash(value['source_text']), 'mode': 'rewrite'})
            from services.editing_service import create_chapter_review
            review = create_chapter_review(self.store, project_id, value['chapter_id'], merged, job_id=trial_id, source='author_trial')
            result = {**result, 'review_id': review['review_id'], 'review_required': True}
            value.pop('revision', None)
            value.update(status='applied', result=result, applied_at=now_iso())
            return self._save(project_id, value)

    def discard(self, project_id, trial_id, body):
        with self._lock(project_id):
            check_revision(self.store, project_id, self._path(trial_id), body.get('revision', ''))
            value = self.get(project_id, trial_id)
            if value['status'] == 'applied':
                raise ValueError('已采用的正文请使用正文版本恢复，不覆盖后来的编辑。')
            value.pop('revision', None)
            value.update(status='discarded')
            result = self._save(project_id, value)
            running = ACTIVE.get((str(self.store._project_dir(project_id)), trial_id))
            if running and not running.done():
                running.get_loop().call_soon_threadsafe(running.cancel)
            return result
