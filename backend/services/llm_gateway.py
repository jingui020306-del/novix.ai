from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator

from services.token_usage import normalize_usage

try:
    import httpx  # type: ignore
except Exception:
    httpx = None


class LLMGateway:
    def __init__(self) -> None:
        self.timeout = float(os.getenv("LLM_TIMEOUT_S", "60"))

    def env_defaults(self) -> dict[str, Any]:
        return {
            "provider": os.getenv("DEFAULT_LLM_PROVIDER", "mock"),
            "model": os.getenv("DEFAULT_LLM_MODEL", "mock-writer-v1"),
            "base_url": os.getenv("OPENAI_COMPAT_BASE_URL", "http://127.0.0.1:11434"),
            "api_key": os.getenv("OPENAI_COMPAT_API_KEY", ""),
            "timeout_s": 60,
            "stream": True,
        }

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
        extra: dict[str, Any],
    ) -> AsyncIterator[str]:
        provider = extra.get("provider", "mock")
        reported: dict = {}
        options = {**extra, '_report_usage': reported.update}
        output = []
        try:
            if provider == "mock":
                for token in self._mock_text(messages):
                    await asyncio.sleep(0)
                    output.append(token)
                    yield token
            elif provider == "ollama":
                async for delta in self._ollama_stream(messages, model, temperature, max_tokens, options):
                    output.append(delta)
                    yield delta
            elif provider in {"openai_compat", "llama_cpp"}:
                async for delta in self._openai_compat_stream(messages, model, temperature, max_tokens, options):
                    output.append(delta)
                    yield delta
            else:
                raise RuntimeError(f"unsupported provider: {provider}")
        finally:
            callback = extra.get('_usage_callback')
            if callable(callback):
                callback(normalize_usage(reported, messages=messages, text=''.join(output)))

    async def chat_complete(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
        extra: dict[str, Any],
    ) -> dict[str, Any]:
        content = []
        reported: dict = {}
        def receive(usage):
            reported.update(usage)
            callback = extra.get('_usage_callback')
            if callable(callback):
                callback(usage)
        async for d in self.chat_stream(messages, model, temperature, max_tokens, {**extra, '_usage_callback': receive}):
            content.append(d)
        text = "".join(content)
        usage = normalize_usage(reported, messages=messages, text=text)
        return {"text": text, "usage": usage}


    def _require_httpx(self) -> None:
        if httpx is None:
            raise RuntimeError("httpx is required for non-mock providers")

    async def _ollama_stream(self, messages: list[dict[str, str]], model: str, temperature: float, max_tokens: int, extra: dict[str, Any]) -> AsyncIterator[str]:
        self._require_httpx()
        base = extra.get("base_url") or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        normalized = []
        for message in messages:
            blocks = message.get('content')
            if isinstance(blocks, list):
                text = '\n'.join(str(block.get('text', '')) for block in blocks if block.get('type') == 'text')
                images = []
                for block in blocks:
                    if block.get('type') == 'image_url':
                        url = block.get('image_url', {}).get('url', '')
                        if not url.startswith('data:image/') or ';base64,' not in url:
                            raise ValueError('本地视觉模型需要上传后的图片数据。')
                        images.append(url.split(';base64,', 1)[1])
                normalized.append({**message, 'content': text, 'images': images})
            else:
                normalized.append(message)
        payload = {
            "model": model,
            "messages": normalized,
            "stream": extra.get("stream", True),
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if extra.get('format'):
            payload['format'] = extra['format']
        timeout = float(extra.get("timeout_s", self.timeout))
        async with httpx.AsyncClient(timeout=timeout, trust_env=not extra.get('local_only', False)) as client:
            async with client.stream("POST", f"{base.rstrip('/')}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    obj = json.loads(line)
                    if 'prompt_eval_count' in obj or 'eval_count' in obj:
                        callback = extra.get('_report_usage')
                        if callable(callback):
                            callback({'prompt_tokens': obj.get('prompt_eval_count'), 'completion_tokens': obj.get('eval_count')})
                    chunk = obj.get("message", {}).get("content", "")
                    if chunk:
                        yield chunk

    async def _openai_compat_stream(self, messages: list[dict[str, str]], model: str, temperature: float, max_tokens: int, extra: dict[str, Any]) -> AsyncIterator[str]:
        self._require_httpx()
        provider = extra.get("provider", "openai_compat")
        if provider == "llama_cpp":
            base = extra.get("base_url") or os.getenv("LLAMA_CPP_BASE_URL", "http://127.0.0.1:8080")
        else:
            base = extra.get("base_url") or os.getenv("OPENAI_COMPAT_BASE_URL", "http://127.0.0.1:8001")
        api_key = extra.get("api_key") or ("" if extra.get("local_only") else os.getenv("OPENAI_COMPAT_API_KEY", ""))
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": extra.get("stream", True),
        }
        if extra.get('format'):
            payload['response_format'] = {'type': 'json_schema', 'json_schema': {
                'name': 'pacing', 'strict': True, 'schema': extra['format']}}
        timeout = float(extra.get("timeout_s", self.timeout))
        async with httpx.AsyncClient(timeout=timeout, trust_env=not extra.get('local_only', False)) as client:
            async with client.stream("POST", f"{base.rstrip('/')}/v1/chat/completions", headers=headers, json=payload) as resp:
                resp.raise_for_status()
                if not payload["stream"]:
                    await resp.aread()
                    result = resp.json()
                    callback = extra.get('_report_usage')
                    if callable(callback) and isinstance(result.get('usage'), dict):
                        callback(result['usage'])
                    yield result['choices'][0]['message']['content']
                    return
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    obj = json.loads(data)
                    if isinstance(obj.get('usage'), dict):
                        callback = extra.get('_report_usage')
                        if callable(callback):
                            callback(obj['usage'])
                    choices = obj.get('choices') or []
                    delta = (choices[0].get("delta") or {}).get("content", "") if choices else ''
                    if delta:
                        yield delta

    def _mock_text(self, messages: list[dict[str, str]]) -> str:
        prompt = messages[-1].get("content", "") if messages else ""
        return f"Mock响应：{prompt[:220]}"
