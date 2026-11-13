from __future__ import annotations

from statistics import mean
from typing import Any

from services.kb_service import KBService
from services.kb_service import text_features
from services.edit_version_service import revision
from storage.fs_store import FSStore


class StyleService:
    def __init__(self, store: FSStore, kb: KBService):
        self.store = store
        self.kb = kb

    def analyze(self, project_id: str, style_card_id: str, asset_ids: list[str], mode: str = "fast", *, import_id=None) -> dict[str, Any]:
        import re
        if not re.fullmatch(r'[\w-]{1,120}', style_card_id) or not isinstance(asset_ids, list) or any(not isinstance(value, str) or not re.fullmatch(r'[\w-]{1,120}', value) for value in asset_ids):
            raise ValueError('请选择有效的文风卡和原始参考样本。')
        samples, versions, evidence = [], {}, []
        for asset_id in dict.fromkeys(asset_ids):
            sample = self.kb.get_asset_text(project_id, asset_id, 'style_sample')
            metadata = self.store.read_json(project_id, sample['path'] + '.json')
            if metadata.get('source_kind') == 'ai_example':
                raise ValueError('AI效果示例不能作为原始样本分析，请选择作者提供的参考原文。')
            if sample['content'].strip():
                samples.append(sample['content'])
                versions[sample['path']] = revision(self.store, project_id, sample['path'])
                evidence.append({'asset_id': asset_id, 'quote': sample['content'][:500], 'kind': 'author_reference'})
        if import_id:
            from services.material_import_service import MaterialImportService
            batch = MaterialImportService(self.store).get(project_id, import_id)
            if batch['source'].get('kind') == 'ai_example':
                raise ValueError('AI效果示例不能作为原始样本分析。')
            text = batch['source'].get('original_text') or ''
            if text.strip():
                samples.append(text)
                versions[f'sessions/material_imports/{import_id}.json'] = batch['revision']
                evidence.append({'import_id': import_id, 'quote': text[:500], 'kind': 'author_reference'})
        if not samples:
            raise ValueError('请先选择或导入参考原文；没有样本时不会生成固定文风设置。')
        feats = [text_features(text) for text in samples]
        avg_sentence = mean(f['avg_sentence_len'] for f in feats)
        avg_dialogue = mean(f['dialogue_ratio'] for f in feats)
        exclamation = mean(f['punctuation_profile']['exclamation'] for f in feats)
        guide = {
            "sentence_length": f"样本平均每句约{round(avg_sentence)}字；按场景调整长短句，不机械限定句长。",
            "dialogue_ratio": f"样本每千字约{round(avg_dialogue * 1000)}个引号或冒号；这是标记频率，非对白篇幅比例。",
            "punctuation": f"样本每千字约{round(exclamation * 1000, 1)}个感叹号；表达仍服从当场语气。",
        }
        style = self.store.read_yaml(project_id, f"cards/{style_card_id}.yaml")
        style = style or {'id': style_card_id, 'type': 'style', 'title': '作品文风', 'tags': [], 'links': [], 'payload': {}}
        payload = dict(style.get("payload", {}))
        payload["style_guide"] = {**payload.get('style_guide', {}), **guide}
        payload["active_style_sample_asset_ids"] = asset_ids
        payload.setdefault("injection_policy", {"max_examples": 5, "max_chars_per_example": 800})
        style["payload"] = payload
        profile = {
            "style_card_id": style_card_id,
            "mode": mode,
            "assets": asset_ids,
            "stats": {"avg_sentence_len": avg_sentence, "avg_dialogue_ratio": avg_dialogue, "avg_exclamation": exclamation},
            "guide": guide,
            'candidate': style,
            'base_revision': revision(self.store, project_id, f'cards/{style_card_id}.yaml'),
            'source_versions': versions,
            'evidence': evidence,
            'method': 'local_statistics',
        }
        return profile
