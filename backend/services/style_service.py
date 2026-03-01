from __future__ import annotations

from statistics import mean
from typing import Any

from services.kb_service import KBService
from storage.fs_store import FSStore


class StyleService:
    def __init__(self, store: FSStore, kb: KBService):
        self.store = store
        self.kb = kb

    def analyze(self, project_id: str, style_card_id: str, asset_ids: list[str], mode: str = "fast") -> dict[str, Any]:
        matches = self.kb.query(project_id, "kb_style", " ".join(asset_ids) or "风格 叙事", top_k=50, filters={"asset_ids": asset_ids} if asset_ids else {})
        if not matches:
            matches = self.kb.query(project_id, "kb_style", "叙事 对白 节奏", top_k=50)
        feats = [m["features"] for m in matches] if matches else []
        avg_sentence = mean([f["avg_sentence_len"] for f in feats]) if feats else 24.0
        avg_dialogue = mean([f["dialogue_ratio"] for f in feats]) if feats else 0.03
        exclamation = mean([f["punctuation_profile"]["exclamation"] for f in feats]) if feats else 0.001
        guide = {
            "sentence_length": f"推荐句长约 {int(max(12, min(36, avg_sentence)))} 字",
            "dialogue_ratio": "对白占比中低" if avg_dialogue < 0.06 else "对白占比中高",
            "punctuation": "尽量减少感叹号" if exclamation < 0.003 else "允许少量感叹号",
            "notes": "保持冷静观察视角，优先动作与细节。",
        }
        style = self.store.read_yaml(project_id, f"cards/{style_card_id}.yaml")
        payload = style.get("payload", {})
        payload["style_guide"] = guide
        payload["active_style_sample_asset_ids"] = asset_ids
        payload.setdefault("injection_policy", {"max_examples": 5, "max_chars_per_example": 800})
        payload.setdefault("locks", {"pov": True, "tense": True, "punctuation": True, "taboo_words": True})
        style["payload"] = payload
        self.store.write_yaml(project_id, f"cards/{style_card_id}.yaml", style)
        profile = {
            "style_card_id": style_card_id,
            "mode": mode,
            "assets": asset_ids,
            "stats": {"avg_sentence_len": avg_sentence, "avg_dialogue_ratio": avg_dialogue, "avg_exclamation": exclamation},
            "guide": guide,
        }
        self.store.write_json(project_id, "meta/summaries/style_profile.json", profile)
        return profile
