import uvicorn
from fastapi import FastAPI

from focara.config import DEFAULT_HOST, backend_port

app = FastAPI(title="Focara")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def run() -> None:
    # 常に 127.0.0.1 に bind する。公開は frontend 側のみで行う。
    uvicorn.run("focara.main:app", host=DEFAULT_HOST, port=backend_port())


if __name__ == "__main__":
    run()
