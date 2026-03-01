from __future__ import annotations

import re
import uuid
from html.parser import HTMLParser

from storage.fs_store import FSStore


class _MiniHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.in_title = False
        self.text_parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        self.text_parts.append(data)


class WikiImportService:
    def __init__(self, store: FSStore):
        self.store = store

    def import_html(self, project_id: str, html: str, url: str = "", kind: str = "auto") -> dict:
        import_id = f"wiki_{uuid.uuid4().hex[:10]}"
        self.store.write_md(project_id, f"assets/wiki/{import_id}.html", html)
        parsed = self._parse(html, url=url, kind=kind)
        self.store.write_json(project_id, f"meta/wiki/{import_id}.json", parsed)
        proposals = []
        for c in parsed.get("candidates", {}).get("characters", [])[:5]:
            proposals.append({"proposal_id": f"proposal_{uuid.uuid4().hex[:10]}", "status": "pending", "entity_type": "character", "name": c, "confidence": 0.75, "source": f"wiki({import_id})", "evidence": {"quote": c}})
        for w in parsed.get("candidates", {}).get("world", [])[:5]:
            proposals.append({"proposal_id": f"proposal_{uuid.uuid4().hex[:10]}", "status": "pending", "entity_type": "lore", "name": w, "confidence": 0.72, "source": f"wiki({import_id})", "evidence": {"quote": w}})
        for p in proposals:
            self.store.append_jsonl(project_id, "canon/proposals.jsonl", p)
        return {"import_id": import_id, "parsed": parsed, "proposals": proposals}

    def _parse(self, html: str, url: str, kind: str) -> dict:
        parser = _MiniHTMLParser()
        parser.feed(html)
        title = parser.title.strip() or "untitled"
        sections = []
        for m in re.finditer(r"<h[23][^>]*>(.*?)</h[23]>\s*(<p[^>]*>.*?</p>)?", html, flags=re.I | re.S):
            h = re.sub(r"<[^>]+>", "", m.group(1)).strip()
            p = re.sub(r"<[^>]+>", "", m.group(2) or "").strip()
            sections.append({"h": h, "text": p[:1200]})
        infobox = {}
        for m in re.finditer(r"<tr[^>]*>\s*<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>\s*</tr>", html, flags=re.I | re.S):
            k = re.sub(r"<[^>]+>", "", m.group(1)).strip()
            v = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            if k:
                infobox[k] = v
        plain = " ".join(parser.text_parts)
        words = re.findall(r"[\u4e00-\u9fa5]{2,8}", plain)
        return {
            "title": title,
            "url": url,
            "kind": kind,
            "infobox": infobox,
            "sections": sections,
            "candidates": {"characters": words[:8], "world": words[8:16], "items": words[16:24]},
        }
