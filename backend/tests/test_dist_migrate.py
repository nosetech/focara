"""dist/scripts/migrate.sh のテスト(一時ディレクトリに旧・新の展開先を組み立てて実行する)。"""

import os
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
MIGRATE = REPO / "dist" / "scripts" / "migrate.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("sqlite3") is None or shutil.which("uv") is None,
    reason="sqlite3 と uv が必要",
)


def _head_revision() -> str:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from focara.db.migrate import MIGRATIONS_DIR

    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    head = ScriptDirectory.from_config(cfg).get_current_head()
    assert head is not None
    return head


def _make_deploy(root: Path, with_scripts: bool) -> Path:
    root.mkdir()
    (root / "config").mkdir()
    backend = root / "backend"
    backend.mkdir()
    for name in ("pyproject.toml", "uv.lock", "focara"):
        (backend / name).symlink_to(BACKEND / name)
    if with_scripts:
        (root / "scripts").mkdir()
        shutil.copy(MIGRATE, root / "scripts" / "migrate.sh")
        shutil.copy(REPO / "dist" / "config" / "config.yaml.example", root / "config")
    return root


def _make_db(path: Path, revision: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
    con.execute("INSERT INTO alembic_version VALUES (?)", (revision,))
    con.execute("CREATE TABLE t (v TEXT)")
    con.execute("INSERT INTO t VALUES ('hello')")
    con.commit()
    con.close()


@pytest.fixture
def deploys(tmp_path: Path) -> tuple[Path, Path]:
    old = _make_deploy(tmp_path / "old", with_scripts=False)
    new = _make_deploy(tmp_path / "new", with_scripts=True)
    (old / "config" / "config.yaml").write_text("instance: old\n", encoding="utf-8")
    _make_db(old / "backend" / "data" / "focara.db", _head_revision())
    (old / ".env").write_text("LAN_IP=192.168.1.10\n", encoding="utf-8")
    (old / "backend" / "logs").mkdir()
    (old / "backend" / "logs" / "backend.log").write_text("log", encoding="utf-8")
    return old, new


def _run(new: Path, *args: str | Path) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "UV_PROJECT_ENVIRONMENT": str(BACKEND / ".venv"),
        "UV_NO_SYNC": "1",
    }
    return subprocess.run(
        [str(new / "scripts" / "migrate.sh"), *map(str, args)],
        capture_output=True,
        text=True,
        env=env,
    )


def _value(db: Path) -> str:
    con = sqlite3.connect(db)
    try:
        return con.execute("SELECT v FROM t").fetchone()[0]
    finally:
        con.close()


def test_migrates_config_db_env(deploys):
    old, new = deploys
    r = _run(new, old)
    assert r.returncode == 0, r.stderr
    assert (new / "config" / "config.yaml").read_text(encoding="utf-8") == "instance: old\n"
    assert _value(new / "backend" / "data" / "focara.db") == "hello"
    assert (new / ".env").read_text(encoding="utf-8") == "LAN_IP=192.168.1.10\n"
    assert not (new / "backend" / "logs").exists()  # --with-logs なしでは引き継がない
    assert (old / "config" / "config.yaml").exists()  # 旧は変更しない
    assert "並行稼働" in r.stderr  # ポート等の衝突警告


def test_with_logs(deploys):
    old, new = deploys
    r = _run(new, old, "--with-logs")
    assert r.returncode == 0, r.stderr
    assert (new / "backend" / "logs" / "backend.log").read_text(encoding="utf-8") == "log"


def test_skips_existing_and_is_idempotent(deploys):
    old, new = deploys
    (new / "config" / "config.yaml").write_text("instance: keep\n", encoding="utf-8")
    r = _run(new, old)
    assert r.returncode == 0, r.stderr
    assert (new / "config" / "config.yaml").read_text(encoding="utf-8") == "instance: keep\n"
    assert _run(new, old).returncode == 0


def test_force_backs_up(deploys):
    old, new = deploys
    (new / "config" / "config.yaml").write_text("instance: keep\n", encoding="utf-8")
    r = _run(new, old, "--force")
    assert r.returncode == 0, r.stderr
    assert (new / "config" / "config.yaml").read_text(encoding="utf-8") == "instance: old\n"
    backups = list((new / "config").glob("config.yaml.bak-*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "instance: keep\n"


def test_invalid_yaml_stops(deploys):
    old, new = deploys
    (old / "config" / "config.yaml").write_text("unknown_key: 1\n", encoding="utf-8")
    r = _run(new, old)
    assert r.returncode != 0
    assert not (new / "config" / "config.yaml").exists()


def test_too_new_schema_stops(deploys):
    old, new = deploys
    _make_db(old / "backend" / "data" / "focara.db.tmp", "ffffffffffff")
    (old / "backend" / "data" / "focara.db").unlink()
    (old / "backend" / "data" / "focara.db.tmp").rename(old / "backend" / "data" / "focara.db")
    r = _run(new, old)
    assert r.returncode != 0
    assert not (new / "backend" / "data" / "focara.db").exists()


def test_same_dir_stops(deploys):
    _, new = deploys
    r = _run(new, new)
    assert r.returncode != 0
    assert "同じ" in r.stderr
