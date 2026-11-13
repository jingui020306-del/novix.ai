from __future__ import annotations

import json
import re
from pathlib import PurePosixPath

from services.shared_material_service import SharedMaterialService
from services.summary_service import make_summaries


class SelectiveExportService:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def _clean(value):
        if isinstance(value, dict):
            return {key: SelectiveExportService._clean(item) for key, item in value.items()
                    if str(key).lower().replace('-', '_') not in {'api_key', 'apikey', 'password', 'client_secret', 'api_secret', 'secret_key', 'access_token', 'refresh_token', 'authorization', 'base64', 'image_data', 'raw_image'}}
        if isinstance(value, list):
            return [SelectiveExportService._clean(item) for item in value]
        if isinstance(value, str):
            return re.sub(r'data:[^\s;]+;base64,[A-Za-z0-9+/=\s]+', '[图片原始数据未导出]', value)
        return value

    def _resolve(self, project_id, source):
        path, _, fragment = source.partition('#')
        parts = PurePosixPath(path).parts
        if len(parts) != 2 or any(part in {'.', '..'} for part in parts):
            raise ValueError('资料来源不允许导出。')
        if parts[0] == 'cards' and path.endswith(('.yaml', '.json')):
            value = self.store.read_yaml(project_id, path) if path.endswith('.yaml') else self.store.read_json(project_id, path)
        elif parts[0] == 'drafts' and path.endswith('.md') and not fragment:
            return self._clean(self.store.read_md(project_id, path))
        elif path == 'canon/facts.jsonl' and re.fullmatch(r'L[1-9]\d*', fragment):
            rows = self.store.read_jsonl(project_id, path)
            index = int(fragment[1:]) - 1
            if index >= len(rows):
                raise ValueError('事实来源已经变化，请重新选择。')
            return self._clean(rows[index])
        else:
            raise ValueError('仅可导出当前作品的文字资料，不允许导出配置或图片。')
        if fragment:
            for key in fragment.split('.'):
                if isinstance(value, dict) and key in value:
                    value = value[key]
                elif isinstance(value, list) and key.isdigit() and int(key) < len(value):
                    value = value[int(key)]
                else:
                    raise ValueError('资料位置已经变化，请重新选择。')
        return self._clean(value)

    @staticmethod
    def _summary(value, node):
        if isinstance(value, str):
            return '本地摘录：\n\n' + make_summaries(node['id'], value)['chapter_summary']
        if isinstance(value, dict):
            payload = value.get('payload') if isinstance(value.get('payload'), dict) else value
            text = payload.get('summary')
            if isinstance(text, str) and text.strip():
                content = text[:1200]
            else:
                fields = ['name', 'identity', 'appearance', 'scene', 'plot', 'purpose', 'goal', 'setting', 'content', 'value', 'key', 'core_motivation', 'tone', 'rules', 'boundaries']
                pieces = [str(payload[key]) if not isinstance(payload[key], (dict, list)) else json.dumps(payload[key], ensure_ascii=False) for key in fields if payload.get(key)]
                content = '\n\n'.join(pieces)[:1200] or '此条资料没有可直接摘录的正文。'
            if value.get('evidence'):
                content += '\n\n原文证据：\n\n' + json.dumps(value['evidence'], ensure_ascii=False, indent=2)
            if value.get('sources'):
                content += '\n\n引用来源：\n\n' + json.dumps(value['sources'], ensure_ascii=False, indent=2)
            return '本地摘要或摘录（最多摘取 1200 字；未调用模型）：\n\n' + content
        return '本地摘录：\n\n' + json.dumps(value, ensure_ascii=False)[:1200]

    def export(self, project_id, items, detail):
        if detail not in {'summary', 'full'}:
            raise ValueError('请选择摘要或完整内容。')
        if not isinstance(items, list) or not 1 <= len(items) <= 100 or any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in items):
            raise ValueError('请选择 1 到 100 项资料再导出。')
        catalog = {node['id']: node for node in SharedMaterialService(self.store).catalog(project_id)}
        parts = ['# 所选写作资料\n\n内容范围：' + ('完整文字资料' if detail == 'full' else '本地摘要与摘录')]
        seen = set()
        for item in items:
            material_id = item['id']
            if material_id in seen:
                continue
            seen.add(material_id)
            node = catalog.get(material_id)
            if not node:
                raise ValueError('所选资料不存在或不属于可导出文字资料，请重新选择。')
            value = self._resolve(project_id, node['source'])
            content = self._summary(value, node) if detail == 'summary' else value if isinstance(value, str) else '```json\n' + json.dumps(value, ensure_ascii=False, indent=2) + '\n```'
            status = {'author_saved': '作者已保存', 'author_plan': '作者规划', 'supported': '有正文依据', 'unverified': '待核验', 'pending': '待确认', 'unset': '未设定', 'not_applicable': '不适用', 'hypothesis': '推定', 'inspiration': '灵感'}.get(node.get('status'), '作者资料')
            parts.append(f"## {node['label']}\n\n来源：`{node['source']}`\n\n状态：{status}\n\n{content}")
            if len('\n\n'.join(parts)) + 1 > 300000:
                raise ValueError('所选资料超过 300000 字符，请减少条目后分次导出；完整内容不会被截断。')
        return '\n\n'.join(parts) + '\n'
