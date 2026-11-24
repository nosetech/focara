"""dist/scripts/service.sh のテスト(launchd には登録せず、plist 生成と前提チェックのみ検証する)。"""

import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
DIST = REPO / "dist" / "scripts"

pytestmark = pytest.mark.skipif(
    sys.platform != "darwin" or shutil.which("uv") is None or shutil.which("node") is None,
    reason="macOS(launchd・plutil)と uv・node が必要",
)


def _make_deploy(root: Path, *, ready: bool = True) -> Path:
    (root / "scripts").mkdir(parents=True)
    (root / "config").mkdir()
    for src in (
        DIST / "service.sh",
        DIST / "com.nosetech.focara.frontend.plist.example",
        REPO / "scripts" / "lib.sh",
        REPO / "scripts" / "com.nosetech.focara.backend.plist.example",
    ):
        shutil.copy(src, root / "scripts" / src.name)
    backend = root / "backend"
    backend.mkdir()
    for name in ("pyproject.toml", "uv.lock", "focara"):
        (backend / name).symlink_to(BACKEND / name)
    (root / "config" / "config.yaml").write_text("instance: disttest\n", encoding="utf-8")
    if ready:
        py = backend / ".venv" / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.write_text("#!/bin/sh\n", encoding="utf-8")
        py.chmod(0o755)
        (root / "frontend").mkdir()
        (root / "frontend" / "server.js").write_text("", encoding="utf-8")
    return root


def _run(root: Path, home: Path, *args: str, env: dict[str, str] | None = None):
    full = {
        **os.environ,
        "HOME": str(home),
        "UV_PROJECT_ENVIRONMENT": str(BACKEND / ".venv"),
        "UV_NO_SYNC": "1",
        "UV_CACHE_DIR": str(Path.home() / ".cache" / "uv"),
        **(env or {}),
    }
    for key in ("LAN_IP", "TAILSCALE_IP"):
        if not env or key not in env:
            full.pop(key, None)
    return subprocess.run(
        [str(root / "scripts" / "service.sh"), *args],
        capture_output=True,
        text=True,
        env=full,
    )


def _load(home: Path, svc: str) -> dict:
    path = home / "Library" / "LaunchAgents" / f"com.nosetech.focara.disttest.{svc}.plist"
    with path.open("rb") as f:
        return plistlib.load(f)


def test_render_generates_valid_plists(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara")
    home = tmp_path / "home"
    (root / ".env").write_text("LAN_IP=192.168.1.10\n", encoding="utf-8")
    r = _run(root, home, "render")
    assert r.returncode == 0, r.stderr
    fe = _load(home, "frontend")
    assert fe["Label"] == "com.nosetech.focara.disttest.frontend"
    assert fe["ProgramArguments"][1] == f"{root}/frontend/server.js"
    assert fe["WorkingDirectory"] == f"{root}/frontend"
    env = fe["EnvironmentVariables"]
    assert env["HOSTNAME"] == "192.168.1.10"  # .env の LAN_IP を読む
    assert env["NODE_ENV"] == "production"
    assert env["BACKEND_URL"].startswith("http://127.0.0.1:")
    assert "PORT" in env
    be = _load(home, "backend")
    assert be["ProgramArguments"][0] == f"{root}/backend/.venv/bin/python"
    assert be["KeepAlive"] is True


def test_render_defaults_to_localhost(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara")
    home = tmp_path / "home"
    assert _run(root, home, "render").returncode == 0
    assert _load(home, "frontend")["EnvironmentVariables"]["HOSTNAME"] == "127.0.0.1"


def test_both_ips_is_error(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara")
    (root / ".env").write_text("LAN_IP=192.168.1.10\nTAILSCALE_IP=100.64.0.1\n", encoding="utf-8")
    r = _run(root, tmp_path / "home", "render")
    assert r.returncode != 0
    assert "同時に指定できません" in r.stderr


def test_missing_prerequisites(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara", ready=False)
    home = tmp_path / "home"
    r = _run(root, home, "install")
    assert r.returncode != 0
    assert "uv sync --frozen" in r.stderr
    agents = home / "Library" / "LaunchAgents"
    assert not (agents / "com.nosetech.focara.disttest.backend.plist").exists()


def test_missing_frontend_server(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara")
    (root / "frontend" / "server.js").unlink()
    r = _run(root, tmp_path / "home", "install")
    assert r.returncode != 0
    assert "server.js" in r.stderr


def test_refuses_when_started_manually(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara")
    logs = root / "backend" / "logs"
    logs.mkdir()
    (logs / "focara.disttest.backend.pid").write_text(str(os.getpid()), encoding="utf-8")
    r = _run(root, tmp_path / "home", "install")
    assert r.returncode != 0
    assert "scripts/stop.sh" in r.stderr


def test_usage(tmp_path: Path):
    root = _make_deploy(tmp_path / "focara")
    assert _run(root, tmp_path / "home").returncode != 0
    assert _run(root, tmp_path / "home", "bogus").returncode != 0
