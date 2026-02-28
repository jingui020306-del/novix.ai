from fastapi import APIRouter, HTTPException

from schemas.json_schemas import BLUEPRINT_SCHEMA, CARD_TYPE_SCHEMAS

router = APIRouter(prefix="/api/schema")


@router.get('/card-types')
def card_types():
    return {"types": list(CARD_TYPE_SCHEMAS.keys())}


@router.get('/cards/{type_name}')
def card_schema(type_name: str):
    if type_name not in CARD_TYPE_SCHEMAS:
        raise HTTPException(status_code=404, detail="Unknown card type")
    return CARD_TYPE_SCHEMAS[type_name]


@router.get('/blueprint')
def blueprint_schema():
    return BLUEPRINT_SCHEMA
