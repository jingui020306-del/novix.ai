from fastapi import APIRouter, Depends, HTTPException

from services.evidence_service import EvidenceService
from storage.fs_store import FSStore


def get_store() -> FSStore:
    from main import store

    return store


router = APIRouter(prefix="/api/projects/{project_id}")


@router.get("/chapters/{chapter_id}/evidence-marks")
def list_evidence_marks(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    return EvidenceService(s).list_marks(project_id, chapter_id)


@router.post("/chapters/{chapter_id}/analyze-marks")
def analyze_evidence_marks(project_id: str, chapter_id: str, body: dict | None = None, s: FSStore = Depends(get_store)):
    chapter_text = s.read_md(project_id, f"drafts/{chapter_id}.md")
    if not chapter_text:
        raise HTTPException(status_code=404, detail="chapter not found")
    body = body or {}
    svc = EvidenceService(s)
    meta = s.read_json(project_id, f"drafts/{chapter_id}.meta.json")
    marks = svc.build_marks(
        project_id,
        chapter_id,
        job_id=str(body.get("job_id") or ""),
        model=str(body.get("model") or ""),
        technique_checklist=meta.get("technique_checklist", []),
        issues=body.get("issues", []),
    )
    svc.save_marks(project_id, chapter_id, marks)
    report = svc.build_trust_report(project_id, chapter_id, marks)
    return {"marks": marks, "trust_report": report}


@router.get("/trust-report")
def get_trust_report(project_id: str, chapter_id: str, s: FSStore = Depends(get_store)):
    if not chapter_id:
        raise HTTPException(status_code=400, detail="chapter_id required")
    return EvidenceService(s).get_trust_report(project_id, chapter_id)
