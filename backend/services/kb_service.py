from __future__ import annotations

import math
import re
import uuid
from collections import Counter, defaultdict
from typing import Any

from storage.fs_store import FSStore

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+previous\s+instructions", re.I),
    re.compile(r"system\s+prompt", re.I),
    re.compile(r"你现在必须"),
    re.compile(r"忽略之前"),
]


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
            if not s.strip():
                continue
            if len(buf) + len(s) <= 800:
                buf += s
            else:
                if len(buf) >= 300:
                    chunks.append(buf.strip())
                    buf = s
                else:
                    chunks.append((buf + s).strip())
                    buf = ""
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
            out.extend([tok[i:i+2] for i in range(max(1, len(tok)-1))])
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
        chunks = split_chunks(cleaned)
        rows = []
        for i, chunk in enumerate(chunks):
            rows.append({
                "chunk_id": f"{asset_id}_c{i:04d}", "kb_id": kb_id, "asset_id": asset_id, "ordinal": i,
                "text": chunk, "cleaned_text": chunk, "features": text_features(chunk),
                "source": {"path": rel, "kind": kind, "asset_id": asset_id, "paragraph_index": i, "filename": filename},
            })
        self.store.write_json(project_id, _kb_rel(kb_id, "bm25.json"), self._build_bm25(rows))
        for r in rows:
            self.store.append_jsonl(project_id, _kb_rel(kb_id, "chunks.jsonl"), r)
        return {"asset_id": asset_id, "saved_path": rel, "warnings": warnings}

    def _build_bm25(self, chunks: list[dict[str, Any]]) -> dict[str, Any]:
        doc_freq: dict[str, int] = defaultdict(int)
        postings: dict[str, dict[str, int]] = {}
        doc_len = {}
        for c in chunks:
            cid = c["chunk_id"]
            toks = _tokenize(c["cleaned_text"])
            counts = Counter(toks)
            doc_len[cid] = len(toks)
            postings[cid] = dict(counts)
            for term in counts.keys():
                doc_freq[term] += 1
        avg_len = (sum(doc_len.values()) / len(doc_len)) if doc_len else 0
        return {"doc_freq": doc_freq, "postings": postings, "doc_len": doc_len, "avg_len": avg_len, "n_docs": len(doc_len)}

    def reindex(self, project_id: str, kb_id: str) -> dict[str, Any]:
        chunks = self.store.read_jsonl(project_id, _kb_rel(kb_id, "chunks.jsonl"))
        bm25 = self._build_bm25(chunks)
        self.store.write_json(project_id, _kb_rel(kb_id, "bm25.json"), bm25)
        return {"ok": True, "kb_id": kb_id, "chunks": len(chunks)}

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
        out = []
        for c in chunks:
            if allow_assets and c["asset_id"] not in allow_assets:
                continue
            cid = c["chunk_id"]
            score = 0.0
            for t in q_terms:
                tf = postings.get(cid, {}).get(t, 0)
                if tf == 0:
                    continue
                df = doc_freq.get(t, 0) + 1
                idf = math.log((n_docs - df + 0.5) / (df + 0.5) + 1)
                dl = max(1, int(doc_len.get(cid, 1)))
                k1 = 1.5
                b = 0.75
                score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_len)))
            overlap = len(set(q_terms) & set(_tokenize(c["cleaned_text"])))
            final_score = score + overlap * 0.1
            if final_score > 0:
                out.append({"chunk_id": cid, "score": round(final_score, 4), "text": c["text"], "source": c["source"], "features": c["features"]})
        out.sort(key=lambda x: x["score"], reverse=True)
        return out[:top_k]
