from pathlib import Path

from sqlalchemy import Engine, create_engine, event

BUSY_TIMEOUT_MS = 5000


def create_db_engine(path: str | Path) -> Engine:
    """SQLite エンジンを作る。接続ごとに WAL・foreign_keys・busy_timeout を設定する。

    DB ファイルの親ディレクトリが無ければ作成する(`:memory:` を除く)。
    """
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}")

    @event.listens_for(engine, "connect")
    def _configure(dbapi_conn, _record) -> None:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        cur.close()

    return engine
