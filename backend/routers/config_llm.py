from __future__ import annotations

from fastapi import APIRouter, Depends

from services.llm_config_service import LLMConfigService, PROVIDERS_META, TASK_AGENT_MODULES


def get_cfg() -> LLMConfigService:
    from main import llm_config_service

    return llm_config_service


router = APIRouter(prefix="/api/config/llm", tags=["config_llm"])


AGENT_MODULES = TASK_AGENT_MODULES


def _profile_status(profile_id: str, profile: dict | None) -> dict:
    profile = profile or {}
    provider = str(profile.get("provider") or "")
    model = str(profile.get("model") or "")
    base_url = str(profile.get("base_url") or "")
    api_key = str(profile.get("api_key") or "")
    requires_key = provider in {"openai_compat"} or provider.startswith("openai")
    missing = []
    if not provider:
        missing.append("provider")
    if not model:
        missing.append("model")
    if provider in {"openai_compat", "ollama", "llama_cpp"} and not base_url:
        missing.append("base_url")
    if requires_key and not api_key:
        missing.append("api_key")
    return {
        "profile_id": profile_id,
        "provider": provider or "missing",
        "model": model,
        "base_url_configured": bool(base_url),
        "api_key_configured": bool(api_key),
        "requires_api_key": requires_key,
        "is_mock": provider == "mock" or profile_id == "mock_default",
        "stream": bool(profile.get("stream", True)),
        "timeout_s": profile.get("timeout_s", 60),
        "missing_fields": missing,
    }


@router.get("/profiles")
def get_profiles(cfg: LLMConfigService = Depends(get_cfg)):
    return {"profiles": cfg.read_profiles()}


@router.post("/profiles")
def post_profiles(body: dict, cfg: LLMConfigService = Depends(get_cfg)):
    mode = body.get("mode", "replace")
    current = cfg.read_profiles()
    if mode == "upsert":
        profile_id = body.get("id")
        profile = body.get("profile", {})
        if profile_id:
            current[str(profile_id)] = profile
    elif mode == "delete":
        profile_id = body.get("id")
        if profile_id:
            current.pop(str(profile_id), None)
    else:
        current = body.get("profiles", {})
    return {"profiles": cfg.write_profiles(current)}


@router.get("/assignments")
def get_assignments(cfg: LLMConfigService = Depends(get_cfg)):
    return {"assignments": cfg.read_assignments()}


@router.post("/assignments")
def post_assignments(body: dict, cfg: LLMConfigService = Depends(get_cfg)):
    mode = body.get("mode", "replace")
    current = cfg.read_assignments()
    if mode == "upsert":
        module = body.get("module")
        profile_id = body.get("profile_id")
        if module and profile_id:
            current[str(module)] = str(profile_id)
    elif mode == "delete":
        module = body.get("module")
        if module:
            current.pop(str(module), None)
    else:
        current = body.get("assignments", {})
    return {"assignments": cfg.write_assignments(current)}


@router.get("/providers_meta")
def get_providers_meta():
    return {"providers": PROVIDERS_META}


@router.get("/status")
def get_status(cfg: LLMConfigService = Depends(get_cfg)):
    profiles = cfg.read_profiles()
    assignments = cfg.read_assignments()
    profile_rows = [
        _profile_status(profile_id, profile)
        for profile_id, profile in sorted(profiles.items(), key=lambda item: str(item[0]))
    ]
    modules = []
    for module in AGENT_MODULES:
        profile_id = assignments.get(module, "mock_default")
        profile = profiles.get(profile_id)
        status = _profile_status(profile_id, profile)
        modules.append({
            "module": module,
            "profile_id": profile_id,
            **status,
            "assignment_missing": module not in assignments,
            "profile_missing": profile is None,
        })
    return {
        "storage": {
            "profiles_path": str(cfg.profiles_file),
            "assignments_path": str(cfg.assignments_file),
            "api_keys_stored_in_profiles_file": True,
            "api_keys_returned_in_status": False,
        },
        "fallback_policy": "request.llm_profile_id > assignment[module] > project.default_llm_profile_id > mock_default; failed provider calls fall back to mock_default and are recorded on the job.",
        "profiles": profile_rows,
        "modules": modules,
        "all_mock": all(row["is_mock"] for row in modules),
        "missing_count": sum(1 for row in modules if row["missing_fields"] or row["profile_missing"]),
        "profile_missing_count": sum(1 for row in profile_rows if row["missing_fields"]),
    }
