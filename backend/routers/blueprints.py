from fastapi import APIRouter, Depends, HTTPException

from schemas.json_schemas import BLUEPRINT_SCHEMA
from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


def validate_blueprint(bp: dict):
    required = ["id", "story_type_id", "scene_plan"]
    for r in required:
        if r not in bp:
            return [r], f"{r} is required"
    if not isinstance(bp.get("scene_plan"), list):
        return ["scene_plan"], "scene_plan must be array"
    for i, sc in enumerate(bp["scene_plan"]):
        for f in ["scene_id", "phase", "purpose", "situation", "choice_points"]:
            if f not in sc:
                return ["scene_plan", i, f], f"{f} is required"
    return None, None


router = APIRouter(prefix='/api/projects/{project_id}/blueprints')


@router.get('')
def list_blueprints(project_id: str, s: FSStore = Depends(get_store)):
    cards_dir = s._safe_path(project_id, 'cards')
    return [s.read_json(project_id, f'cards/{f.name}') for f in cards_dir.glob('blueprint_*.json')]


@router.post('')
def create_blueprint(project_id: str, bp: dict, s: FSStore = Depends(get_store)):
    path, msg = validate_blueprint(bp)
    if msg:
        raise HTTPException(status_code=400, detail={"path": path, "message": msg})
    s.write_json(project_id, f"cards/{bp['id']}.json", bp)
    return bp


@router.put('')
def update_blueprint(project_id: str, bp: dict, s: FSStore = Depends(get_store)):
    return create_blueprint(project_id, bp, s)


@router.delete('/{blueprint_id}')
def delete_blueprint(project_id: str, blueprint_id: str, s: FSStore = Depends(get_store)):
    path = s._safe_path(project_id, f'cards/{blueprint_id}.json')
    if path.exists():
        path.unlink()
    return {"deleted": True}
