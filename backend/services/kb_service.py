from __future__ import annotations

import math
import re
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from storage.fs_store import FSStore

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+previous\s+instructions", re.I),
    re.compile(r"system\s+prompt", re.I),
    re.compile(r"你现在必须"),
    re.compile(r"忽略之前"),
]

KB_IDS = {"kb_style", "kb_docs", "kb_manuscript", "kb_world"}

STAR_WEIGHT_COEFF = 0.15
IMPORTANCE_WEIGHT_COEFF = 0.10
DEFAULT_IMPORTANCE = 3


def sanitize_for_index(text: str) -> tuple[str, list[str]]:
    warnings: list[str] = []
    cleaned = text
    for pat in INJECTION_PATTERNS:
        if pat.search(cleaned):
            warnings.append(f"filtered_prompt_injection:{pat.pattern}")
            cleaned = pat.sub("", cleaned)
    return cleaned.strip(), warnings


def split_chunks(text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    for p in paragraphs:
        if len(p) <= 800:
            chunks.append(p)
            continue
        pieces = re.split(r"(?<=[。！？!?])|\n", p)
        buf = ""
        for s in pieces:
            s = s.strip()
            if not s:
                continue
            if len(buf) + len(s) <= 800:
                buf += s
            else:
                chunks.append((buf or s).strip())
                buf = "" if buf else ""
        if buf.strip():
            chunks.append(buf.strip())
    return chunks or [text[:800]]


def text_features(text: str) -> dict[str, Any]:
    sentences = [x for x in re.split(r"[。！？!?]", text) if x.strip()]
    avg_sentence_len = (sum(len(s) for s in sentences) / len(sentences)) if sentences else len(text)
    dialogue_marks = text.count("“") + text.count("”") + text.count(":") + text.count("：")
    dialogue_ratio = dialogue_marks / max(1, len(text))
    punctuation_profile = {
        "comma": text.count("，") / max(1, len(text)),
        "period": text.count("。") / max(1, len(text)),
        "exclamation": (text.count("!") + text.count("！")) / max(1, len(text)),
    }
    tokens = [t for t in re.findall(r"[\u4e00-\u9fa5A-Za-z0-9]{2,}", text.lower())]
    top_ngrams = [w for w, _ in Counter(tokens).most_common(8)]
    return {
        "avg_sentence_len": round(avg_sentence_len, 2),
        "dialogue_ratio": round(dialogue_ratio, 4),
        "punctuation_profile": punctuation_profile,
        "top_ngrams": top_ngrams,
    }


def _kb_rel(kb_id: str, name: str) -> str:
    return f"meta/kb/{kb_id}/{name}"


def _tokenize(text: str) -> list[str]:
    raw = [t for t in re.findall(r"[一-龥A-Za-z0-9]{2,}", text.lower())]
    out: list[str] = []
    for tok in raw:
        if re.fullmatch(r"[一-龥]+", tok):
            out.extend([tok[i:i + 2] for i in range(max(1, len(tok) - 1))])
        else:
            out.append(tok)
    return out


class KBService:
    def __init__(self, store: FSStore):
        self.store = store

    def upload_text(self, project_id: str, kind: str, filename: str, raw: str) -> dict[str, Any]:
        asset_id = f"{kind}_{uuid.uuid4().hex[:10]}"
        if kind == "style_sample":
            rel = f"assets/style_samples/{asset_id}.txt"
            kb_id = "kb_style"
        else:
            rel = f"assets/docs/{asset_id}.txt"
            kb_id = "kb_docs"
        self.store.write_md(project_id, rel, raw)
        cleaned, warnings = sanitize_for_index(raw)
        rows = self._rows_for_text(kb_id, asset_id, cleaned, {"path": rel, "kind": kind, "asset_id": asset_id, "filename": filename})
        self._append_rows(project_id, kb_id, rows)
        self.reindex(project_id, kb_id)
        return {"asset_id": asset_id, "saved_path": rel, "warnings": warnings}

    def _rows_for_text(self, kb_id: str, ref_id: str, text: str, source_base: dict[str, Any]) -> list[dict[str, Any]]:
        chunks = split_chunks(text)
        rows = []
        for i, chunk in enumerate(chunks):
            src = {**source_base, "paragraph_index": i}
            rows.append({
                "chunk_id": f"{ref_id}_c{i:04d}",
                "kb_id": kb_id,
                "asset_id": source_base.get("asset_id"),
                "ordinal": i,
                "text": chunk,
                "cleaned_text": chunk,
                "features": text_features(chunk),
                "source": src,
            })
        return rows

    def _append_rows(self, project_id: str, kb_id: str, rows: list[dict[str, Any]]) -> None:
        for r in rows:
            self.store.append_jsonl(project_id, _kb_rel(kb_id, "chunks.jsonl"), r)

    def _build_bm25(self, chunks: list[dict[str, Any]]) -> dict[str, Any]:
        doc_freq: dict[str, int] = defaultdict(int)
        postings: dict[str, dict[str, int]] = {}
        doc_len = {}
        for c in chunks:
            cid = c["chunk_id"]
            toks = _tokenize(c.get("cleaned_text", c.get("text", "")))
            counts = Counter(toks)
            doc_len[cid] = len(toks)
            postings[cid] = dict(counts)
            for term in counts.keys():
                doc_freq[term] += 1
        avg_len = (sum(doc_len.values()) / len(doc_len)) if doc_len else 0
        return {"doc_freq": doc_freq, "postings": postings, "doc_len": doc_len, "avg_len": avg_len, "n_docs": len(doc_len)}

    def _reindex_kb(self, project_id: str, kb_id: str) -> dict[str, Any]:
        chunks = self.store.read_jsonl(project_id, _kb_rel(kb_id, "chunks.jsonl"))
        bm25 = self._build_bm25(chunks)
        self.store.write_json(project_id, _kb_rel(kb_id, "bm25.json"), bm25)
        return {"kb_id": kb_id, "chunks": len(chunks)}

    def reindex(self, project_id: str, kb_id: str) -> dict[str, Any]:
        if kb_id == "all":
            self.reindex_manuscript(project_id)
            parts = [self._reindex_kb(project_id, x) for x in ["kb_style", "kb_docs", "kb_manuscript", "kb_world"]]
            return {"ok": True, "kb_id": "all", "parts": parts}
        if kb_id == "kb_manuscript":
            self.reindex_manuscript(project_id)
        if kb_id == "kb_world":
            self.reindex_world(project_id)
        return {"ok": True, **self._reindex_kb(project_id, kb_id)}



    def reindex_world(self, project_id: str) -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        cards_dir = self.store._safe_path(project_id, "cards")
        for y in sorted(cards_dir.glob("world_rule_*.yaml")) + sorted(cards_dir.glob("lore_*.yaml")) + sorted(cards_dir.glob("worldview_*.yaml")):
            data = self.store.read_yaml(project_id, f"cards/{y.name}")
            text = str(data.get("payload", {}))
            chunk_id = f"{y.stem}_c0000"
            rows.append({"chunk_id": chunk_id, "kb_id": "kb_world", "asset_id": None, "ordinal": 0, "text": text, "cleaned_text": text, "features": text_features(text), "source": {"path": f"cards/{y.name}", "kind": "world_card", "card_id": data.get("id", y.stem), "field_path": "payload"}})
        for fact in self.store.read_jsonl(project_id, "canon/facts.jsonl"):
            if fact.get("scope") not in {"world_state", "world_event", "world_rule"}:
                continue
            txt = str(fact.get("value") or fact.get("fact") or "")
            if not txt:
                continue
            cid = fact.get("id") or f"worldfact_{len(rows):04d}"
            rows.append({"chunk_id": f"{cid}_c0000", "kb_id": "kb_world", "asset_id": None, "ordinal": len(rows), "text": txt, "cleaned_text": txt, "features": text_features(txt), "source": {"path": "canon/facts.jsonl", "kind": "world_fact", "fact_id": fact.get("id", cid), "field_path": "value"}})
        self.store.write_md(project_id, _kb_rel("kb_world", "chunks.jsonl"), "")
        for r in rows:
            self.store.append_jsonl(project_id, _kb_rel("kb_world", "chunks.jsonl"), r)
        return {"ok": True, "kb_id": "kb_world", "chunks": len(rows)}
    def reindex_manuscript(self, project_id: str) -> dict[str, Any]:
        drafts_dir = self.store._safe_path(project_id, "drafts")
        rows: list[dict[str, Any]] = []
        for md in sorted(drafts_dir.glob("chapter_*.md")):
            chapter_id = md.stem
            text = md.read_text(encoding="utf-8")
            rows.extend(self._rows_for_chapter(chapter_id, text))
        self.store.write_md(project_id, _kb_rel("kb_manuscript", "chunks.jsonl"), "")
        for r in rows:
            self.store.append_jsonl(project_id, _kb_rel("kb_manuscript", "chunks.jsonl"), r)
        return {"ok": True, "kb_id": "kb_manuscript", "chunks": len(rows)}

    def reindex_manuscript_chapter(self, project_id: str, chapter_id: str) -> None:
        text = self.store.read_md(project_id, f"drafts/{chapter_id}.md")
        chunks_path = self.store._safe_path(project_id, _kb_rel("kb_manuscript", "chunks.jsonl"))
        existing = self.store.read_jsonl(project_id, _kb_rel("kb_manuscript", "chunks.jsonl"))
        kept = [r for r in existing if r.get("source", {}).get("chapter_id") != chapter_id]
        chunks_path.parent.mkdir(parents=True, exist_ok=True)
        chunks_path.write_text("", encoding="utf-8")
        for r in kept:
            self.store.append_jsonl(project_id, _kb_rel("kb_manuscript", "chunks.jsonl"), r)
        for r in self._rows_for_chapter(chapter_id, text):
            self.store.append_jsonl(project_id, _kb_rel("kb_manuscript", "chunks.jsonl"), r)
        self._reindex_kb(project_id, "kb_manuscript")

    def _rows_for_chapter(self, chapter_id: str, text: str) -> list[dict[str, Any]]:
        lines = text.splitlines()
        rows = []
        start = 1
        buf = []
        idx = 0
        for i, line in enumerate(lines, start=1):
            buf.append(line)
            if len("\n".join(buf)) >= 500 or i == len(lines):
                chunk_text = "\n".join(buf).strip()
                if chunk_text:
                    rows.append({
                        "chunk_id": f"{chapter_id}_c{idx:04d}",
                        "kb_id": "kb_manuscript",
                        "asset_id": None,
                        "ordinal": idx,
                        "text": chunk_text,
                        "cleaned_text": chunk_text,
                        "features": text_features(chunk_text),
                        "source": {
                            "path": f"drafts/{chapter_id}.md",
                            "kind": "manuscript",
                            "chapter_id": chapter_id,
                            "start_line": start,
                            "end_line": i,
                            "paragraph_index": idx,
                        },
                    })
                    idx += 1
                start = i + 1
                buf = []
        return rows


    def _card_weight_multiplier(self, project_id: str, source: dict[str, Any]) -> float:
        path = str(source.get("path", ""))
        if not (path.startswith("cards/") and path.endswith(".yaml")):
            return 1.0
        try:
            card = self.store.read_yaml(project_id, path)
        except Exception:
            return 1.0
        stars = float(card.get("stars", 0) or 0)
        importance = float(card.get("importance", DEFAULT_IMPORTANCE) or DEFAULT_IMPORTANCE)
        stars = max(0.0, min(5.0, stars))
        importance = max(1.0, min(5.0, importance))
        return (1.0 + STAR_WEIGHT_COEFF * stars) * (1.0 + IMPORTANCE_WEIGHT_COEFF * (importance - DEFAULT_IMPORTANCE))

    def query(self, project_id: str, kb_id: str, query: str, top_k: int = 5, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        filters = filters or {}
        chunks = self.store.read_jsonl(project_id, _kb_rel(kb_id, "chunks.jsonl"))
        bm25 = self.store.read_json(project_id, _kb_rel(kb_id, "bm25.json"))
        if not bm25:
            bm25 = self._build_bm25(chunks)
        n_docs = max(1, bm25.get("n_docs", 1))
        avg_len = max(1.0, float(bm25.get("avg_len", 1.0)))
        doc_freq = bm25.get("doc_freq", {})
        postings = bm25.get("postings", {})
        doc_len = bm25.get("doc_len", {})
        q_terms = _tokenize(query)
        allow_assets = set(filters.get("asset_ids", []))
        allow_chapters = set(filters.get("chapter_ids", []))
        out = []
        for c in chunks:
            src = c.get("source", {})
            if allow_assets and src.get("asset_id") not in allow_assets:
                continue
            if allow_chapters and src.get("chapter_id") not in allow_chapters:
                continue
            cid = c["chunk_id"]
            score = 0.0
            for t in q_terms:
                tf = postings.get(cid, {}).get(t, 0)
                if tf == 0:
                    continue
                df = doc_freq.get(t, 0) + 1
                idf = max(0.0, math.log((n_docs - df + 0.5) / (df + 0.5) + 1))
                dl = max(1, int(doc_len.get(cid, 1)))
                k1 = 1.5
                b = 0.75
                score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_len)))
            overlap = len(set(q_terms) & set(_tokenize(c.get("cleaned_text", c.get("text", "")))))
            retrieval_score = score + overlap * 0.1
            score_multiplier = self._card_weight_multiplier(project_id, src)
            final_score = retrieval_score * score_multiplier
            if final_score >= 0:
                out.append({
                    "kb_id": kb_id,
                    "chunk_id": cid,
                    "score": round(final_score, 4),
                    "retrieval_score": round(retrieval_score, 4),
                    "score_multiplier": round(score_multiplier, 4),
                    "text": c["text"],
                    "source": c["source"],
                    "features": c.get("features"),
                })
        out.sort(key=lambda x: x["score"], reverse=True)
        return out[:top_k]

    def query_multi(self, project_id: str, query: str, top_k: int, kb: list[dict[str, Any]], filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        filters = filters or {}
        merged: dict[str, dict[str, Any]] = {}
        for item in kb:
            kb_id = item.get("kb_id")
            if kb_id not in KB_IDS:
                continue
            weight = float(item.get("weight", 1.0))
            rows = self.query(project_id, kb_id, query, top_k=max(top_k, 20), filters=filters)
            if not rows:
                continue
            max_score = max(r["score"] for r in rows) or 1.0
            for r in rows:
                key = f"{kb_id}:{r['chunk_id']}"
                norm_score = (r["score"] / max_score) * weight
                if key not in merged or norm_score > merged[key]["score"]:
                    merged[key] = {**r, "score": round(norm_score, 4)}
        out = list(merged.values())
        out.sort(key=lambda x: x["score"], reverse=True)
        return out[:top_k]

    def get_asset_text(self, project_id: str, asset_id: str, kind: str) -> dict[str, Any]:
        if kind == "style_sample":
            rel = f"assets/style_samples/{asset_id}.txt"
        else:
            rel = f"assets/docs/{asset_id}.txt"
        return {"asset_id": asset_id, "kind": kind, "content": self.store.read_md(project_id, rel), "path": rel}
