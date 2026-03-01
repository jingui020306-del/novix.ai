from fastapi import APIRouter, Depends, WebSocket

from jobs.manager import JobManager


def get_manager() -> JobManager:
    from main import job_manager

    return job_manager


router = APIRouter(prefix='/api')


@router.post('/projects/{project_id}/jobs/write')
async def create_job(project_id: str, body: dict, jm: JobManager = Depends(get_manager)):
    job_id = await jm.run_write_job(project_id, body)
    return {"job_id": job_id}


@router.websocket('/jobs/{job_id}/stream')
async def job_stream(job_id: str, websocket: WebSocket):
    from main import job_manager

    await websocket.accept()
    async for event in job_manager.stream(job_id):
        await websocket.send_json(event)
    await websocket.close()
