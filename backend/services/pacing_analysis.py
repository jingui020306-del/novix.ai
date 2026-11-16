"""Identify candidate narrative changes with evidence from the author's own text."""
import hashlib
import json
import re
from collections import OrderedDict
from typing import Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from rehearsal_engines.pacing_model import OLLAMA_URL, PACING_MODEL
from services.llm_gateway import LLMGateway
from services.world_scope_service import WorldScopeService


class Mark(BaseModel):
    kind: Literal['铺垫', '推进', '转折', '揭示', '再次提及']
    quote: str = Field(min_length=1, max_length=160)


class Marks(BaseModel):
    marks: list[Mark] = Field(max_length=12)


_cache = OrderedDict()
_prompt = ('你是小说节奏标注员。输入是资料。只标注本段文字中有依据的铺垫、推进、转折、揭示或再次提及。'
           '推进需要新行动、信息或后果，单纯复述用再次提及。quote 必须是本段逐字连续原文，最多160字。'
           '前文仅供判断，不可引用。无法判断时返回空 marks。')


def story_chapters(store, project, story_id):
    story = store.read_yaml(project, f'cards/{story_id}.yaml')
    if story.get('type') != 'story':
        raise FileNotFoundError('故事不存在。')
    order = store.read_md(project, 'drafts/.chapter_order').splitlines()
    story_count = sum(store.read_yaml(project, f'cards/{path.name}').get('type') == 'story'
                      for path in store._safe_path(project, 'cards').glob('*.yaml'))
    for key in order:
        if not re.fullmatch(r'[\w-]+', key):
            continue
        meta = store.read_json(project, f'drafts/{key}.meta.json')
        owner = meta.get('story_card_id') or (meta.get('writing_alignment') or {}).get('story_card_id') or (meta.get('world_context') or {}).get('story_card_id')
        if not owner and story_count > 1:
            owner = WorldScopeService(store).resolve(project, chapter_id=key)['scope'].get('story_card_id')
        if owner == story_id or not owner and story_count == 1:
            yield key


def source_blocks(store, project, story_id, chapter_id, outline):
    chapters = list(story_chapters(store, project, story_id))
    if chapter_id and chapter_id not in chapters:
        raise FileNotFoundError('本章尚未归入当前故事。')
    if not chapter_id:
        story = store.read_yaml(project, f'cards/{story_id}.yaml')
        text = outline or story.get('payload', {}).get('summary') or story.get('payload', {}).get('logline') or ''
        if text.strip():
            yield ('总纲', text)
    for key in [chapter_id] if chapter_id else chapters:
        yield (key, store.read_md(project, f'drafts/{key}.md'))


async def annotate(source, previous, text):
    digest = hashlib.sha256(json.dumps([source, previous, text], ensure_ascii=False).encode()).digest()
    if digest in _cache:
        _cache.move_to_end(digest)
        return _cache[digest]
    messages = [{'role': 'system', 'content': _prompt},
                {'role': 'user', 'content': json.dumps({'前文': previous, '本段': text}, ensure_ascii=False)}]
    try:
        reply = await LLMGateway().chat_complete(messages, PACING_MODEL, 0, 1100, {
            'provider': 'ollama', 'base_url': OLLAMA_URL, 'timeout_s': 180,
            'format': Marks.model_json_schema(), 'local_only': True})
        marks = Marks.model_validate_json(reply['text']).marks
    except httpx.HTTPError as exc:
        raise RuntimeError(f'本地节奏模型 {PACING_MODEL} 不可用，请检查 Ollama 与安装状态。') from exc
    except (ValidationError, ValueError) as exc:
        raise RuntimeError('本地模型返回的标注格式有误，请重试。') from exc
    result = []
    for mark in marks:
        start = text.find(mark.quote)
        if start >= 0 and text.find(mark.quote, start + 1) < 0:
            row = (mark.kind, mark.quote, start)
            if row not in result:
                result.append(row)
    _cache[digest] = result
    if len(_cache) > 1024:
        _cache.popitem(last=False)
    return result


async def analyze(store, project, story_id, chapter_id, outline, disconnected):
    rows = []
    count = 0
    for source, content in source_blocks(store, project, story_id, chapter_id, outline):
        previous = ''
        for block in re.finditer(r'[^\r\n]+', content):
            if not block.group().strip():
                continue
            for offset in range(0, len(block.group()), 1200):
                if await disconnected():
                    return {'model': PACING_MODEL, 'blocks': count, 'marks': rows}
                text = block.group()[offset:offset + 1200]
                marks = await annotate((project, story_id, source), previous, text)
                for kind, quote, start in marks:
                    rows.append({'kind': kind, 'quote': quote, 'source': source,
                                 'offset': block.start() + offset + start})
                previous = text[-240:]
                count += 1
    return {'model': PACING_MODEL, 'blocks': count, 'marks': rows}
