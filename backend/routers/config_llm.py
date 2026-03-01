from __future__ import annotations

from fastapi import APIRouter, Depends

from services.llm_config_service import LLMConfigService, PROVIDERS_META


def get_cfg() -> LLMConfigService:
    from main import llm_config_service

    return llm_config_service


router = APIRouter(prefix="/api/config/llm", tags=["config_llm"])


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
