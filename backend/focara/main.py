import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from sqlalchemy.orm import Session

from focara.api.deps import get_engine
from focara.api.projects import router as projects_router
from focara.api.properties import router as properties_router
from focara.api.schedule import router as schedule_router
from focara.api.tasks import router as tasks_router
from focara.config import BACKEND_HOST, load_config
from focara.db import create_db_engine, upgrade_db
from focara.task_status import release_due_waiting

RELEASE_INTERVAL_SECONDS = 60


def _release_due() -> None:
    with Session(app.dependency_overrides.get(get_engine, get_engine)()) as session:
        release_due_waiting(session)


async def _release_loop() -> None:
    """待ち日時を過ぎた条件待ちタスクを定期的に next へ戻す。"""
    while True:
        try:
            await asyncio.to_thread(_release_due)
        except Exception:  # noqa: BLE001  一時的な失敗でループを止めない
            logging.getLogger(__name__).exception("条件待ちタスクの復帰に失敗しました")
        await asyncio.sleep(RELEASE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_release_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Focara", lifespan=lifespan)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(schedule_router)
app.include_router(properties_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def run() -> None:
    # 常に 127.0.0.1 に bind する。公開は frontend 側のみで行う。
    cfg = load_config()  # 不正な設定は ConfigError で起動時に失敗する
    engine = create_db_engine(cfg.db.path)  # DBファイルが無ければ作成する
    upgrade_db(engine)
    engine.dispose()
    uvicorn.run("focara.main:app", host=BACKEND_HOST, port=cfg.backend.port)


if __name__ == "__main__":
    run()
