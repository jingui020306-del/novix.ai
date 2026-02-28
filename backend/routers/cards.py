from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix="/api/projects/{project_id}")


def _card_path(card_id: str) -> str:
    return f"cards/{card_id}.yaml"


@router.get('/cards')
def list_cards(project_id: str, type: str | None = None, s: FSStore = Depends(get_store)):
    cards_dir = s._safe_path(project_id, 'cards')
    out = []
    for f in cards_dir.glob('*.yaml'):
        c = s.read_yaml(project_id, str(Path('cards') / f.name))
        if not type or c.get('type') == type:
            out.append(c)
    return out


@router.post('/cards')
def create_card(project_id: str, card: dict, s: FSStore = Depends(get_store)):
    s.write_yaml(project_id, _card_path(card['id']), card)
    return card


@router.get('/cards/{card_id}')
def get_card(project_id: str, card_id: str, s: FSStore = Depends(get_store)):
    c = s.read_yaml(project_id, _card_path(card_id))
    if not c:
        raise HTTPException(status_code=404, detail='Not found')
    return c


@router.put('/cards/{card_id}')
def update_card(project_id: str, card_id: str, card: dict, s: FSStore = Depends(get_store)):
    s.write_yaml(project_id, _card_path(card_id), card)
    return card


@router.delete('/cards/{card_id}')
def delete_card(project_id: str, card_id: str, s: FSStore = Depends(get_store)):
    path = s._safe_path(project_id, _card_path(card_id))
    if path.exists():
        path.unlink()
    return {"deleted": True}
