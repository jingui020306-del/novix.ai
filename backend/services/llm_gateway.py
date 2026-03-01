from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator

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
        if provider == "mock":
            text = self._mock_text(messages)
            for token in text:
                await asyncio.sleep(0)
                yield token
            return

        if provider == "ollama":
            async for d in self._ollama_stream(messages, model, temperature, max_tokens, extra):
                yield d
            return

        if provider in {"openai_compat", "llama_cpp"}:
            async for d in self._openai_compat_stream(messages, model, temperature, max_tokens, extra):
                yield d
            return

        raise RuntimeError(f"unsupported provider: {provider}")

    async def chat_complete(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
        extra: dict[str, Any],
    ) -> dict[str, Any]:
        content = []
        async for d in self.chat_stream(messages, model, temperature, max_tokens, extra):
            content.append(d)
        text = "".join(content)
        usage = {"prompt_tokens": max(1, len(str(messages)) // 4), "completion_tokens": max(1, len(text) // 4)}
        return {"text": text, "usage": usage}


    def _require_httpx(self) -> None:
        if httpx is None:
            raise RuntimeError("httpx is required for non-mock providers")

    async def _ollama_stream(self, messages: list[dict[str, str]], model: str, temperature: float, max_tokens: int, extra: dict[str, Any]) -> AsyncIterator[str]:
        self._require_httpx()
        base = extra.get("base_url") or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        timeout = float(extra.get("timeout_s", self.timeout))
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{base.rstrip('/')}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    obj = json.loads(line)
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
        api_key = extra.get("api_key") or os.getenv("OPENAI_COMPAT_API_KEY", "")
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        timeout = float(extra.get("timeout_s", self.timeout))
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{base.rstrip('/')}/v1/chat/completions", headers=headers, json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    obj = json.loads(data)
                    delta = obj.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta

    def _mock_text(self, messages: list[dict[str, str]]) -> str:
        prompt = messages[-1].get("content", "") if messages else ""
        return f"Mock响应：{prompt[:220]}"
