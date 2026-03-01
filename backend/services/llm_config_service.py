from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class LLMConfigService:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.global_dir = self.data_dir / "_global"
        self.global_dir.mkdir(parents=True, exist_ok=True)
        self.profiles_file = self.global_dir / "llm_profiles.json"
        self.assignments_file = self.global_dir / "agent_assignments.json"
        self._ensure_defaults()

    def _ensure_defaults(self) -> None:
        if not self.profiles_file.exists():
            self.write_profiles({
                "mock_default": {"provider": "mock", "model": "mock-writer-v1", "base_url": "", "api_key": "", "timeout_s": 60, "stream": True}
            })
        if not self.assignments_file.exists():
            self.write_assignments({"writer": "mock_default", "critic": "mock_default", "editor": "mock_default", "canon_extractor": "mock_default"})

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return {}
        data = json.loads(text)
        return data if isinstance(data, dict) else {}

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def read_profiles(self) -> dict[str, Any]:
        data = self._read_json(self.profiles_file)
        if "profiles" in data and isinstance(data["profiles"], dict):
            return data["profiles"]
        return data

    def write_profiles(self, profiles: dict[str, Any]) -> dict[str, Any]:
        self._write_json(self.profiles_file, profiles)
        return profiles

    def read_assignments(self) -> dict[str, str]:
        data = self._read_json(self.assignments_file)
        if "assignments" in data and isinstance(data["assignments"], dict):
            data = data["assignments"]
        return {str(k): str(v) for k, v in data.items()}

    def write_assignments(self, assignments: dict[str, str]) -> dict[str, str]:
        norm = {str(k): str(v) for k, v in assignments.items()}
        self._write_json(self.assignments_file, norm)
        return norm


def _provider_meta(
    provider_id: str,
    display_name: str,
    required_fields: list[str],
    optional_fields: list[str],
    supports_stream: bool,
    defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "provider_id": provider_id,
        "display_name": display_name,
        "required_fields": required_fields,
        "optional_fields": optional_fields,
        "supports_stream": supports_stream,
        "defaults": defaults or {},
    }


PROVIDERS_META: list[dict[str, Any]] = [
    _provider_meta(
        "mock",
        "Mock",
        ["provider", "model"],
        ["stream", "timeout_s"],
        True,
        {"provider": "mock", "model": "mock-writer-v1", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "ollama",
        "Ollama",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "ollama", "model": "qwen2.5:7b", "base_url": "http://127.0.0.1:11434", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "llama_cpp",
        "llama.cpp (OpenAI-Compatible)",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "llama_cpp", "model": "gguf-model", "base_url": "http://127.0.0.1:8080", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:deepseek",
        "OpenAI-Compatible / DeepSeek",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "deepseek-chat", "base_url": "https://api.deepseek.com", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:qwen",
        "OpenAI-Compatible / Qwen",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "qwen-plus", "base_url": "https://dashscope.aliyuncs.com/compatible-mode", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:kimi",
        "OpenAI-Compatible / Kimi",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "moonshot-v1-8k", "base_url": "https://api.moonshot.cn", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:glm",
        "OpenAI-Compatible / GLM",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "glm-4-flash", "base_url": "https://open.bigmodel.cn/api/paas/v4", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:gemini",
        "OpenAI-Compatible / Gemini",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "gemini-2.0-flash", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:grok",
        "OpenAI-Compatible / Grok",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "grok-2-latest", "base_url": "https://api.x.ai", "api_key": "", "stream": True, "timeout_s": 60},
    ),
    _provider_meta(
        "openai_compat:custom",
        "OpenAI-Compatible / Custom",
        ["provider", "model", "base_url"],
        ["api_key", "stream", "timeout_s"],
        True,
        {"provider": "openai_compat", "model": "", "base_url": "", "api_key": "", "stream": True, "timeout_s": 60},
    ),
]
