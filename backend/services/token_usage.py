from __future__ import annotations

from typing import Any


def normalize_usage(usage: dict | None = None, *, messages=None, text: str = '') -> dict:
    usage = usage if isinstance(usage, dict) else {}
    def count(key: str):
        value = usage.get(key)
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
    prompt, completion = count('prompt_tokens'), count('completion_tokens')
    estimated = bool(usage.get('estimated', False) or prompt is None or completion is None)
    text_parts, has_images = [], False
    for message in messages or []:
        content = message.get('content', '') if isinstance(message, dict) else str(message)
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    has_images = has_images or block.get('type') == 'image_url'
                    if block.get('type') == 'text':
                        text_parts.append(str(block.get('text', '')))
        else:
            text_parts.append(str(content))
    image_unknown = bool(usage.get('image_tokens_unknown') or has_images and prompt is None)
    prompt = prompt if prompt is not None else max(1, len('\n'.join(text_parts)) // 4)
    completion = completion if completion is not None else (max(1, len(text) // 4) if text else 0)
    total = count('total_tokens')
    return {'prompt_tokens': prompt, 'completion_tokens': completion, 'total_tokens': total if total is not None else prompt + completion, 'estimated': estimated, **({'image_tokens_unknown': True} if image_unknown else {})}


def summarize_usage(calls: list[dict[str, Any]]) -> dict:
    groups: dict[tuple[str, str, str], dict] = {}
    for call in calls:
        key = tuple(str(call.get(field) or '') for field in ['module', 'provider', 'model'])
        group = groups.setdefault(key, dict(zip(['module', 'provider', 'model'], key), prompt_tokens=0, completion_tokens=0, total_tokens=0, estimated=False))
        usage = normalize_usage(call)
        for field in ['prompt_tokens', 'completion_tokens', 'total_tokens']:
            group[field] += usage[field]
        group['estimated'] = group['estimated'] or usage['estimated']
    rows = list(groups.values())
    return {**{field: sum(row[field] for row in rows) for field in ['prompt_tokens', 'completion_tokens', 'total_tokens']},
            'estimated': any(row['estimated'] for row in rows), 'by_module': rows,
            **({'image_tokens_unknown': True} if any(call.get('image_tokens_unknown') for call in calls) else {})}
