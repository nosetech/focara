import uvicorn
from fastapi import FastAPI

from focara.config import BACKEND_HOST, load_config
from focara.db import create_db_engine, upgrade_db

app = FastAPI(title="Focara")


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
