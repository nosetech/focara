import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import pytest

from focara.ai import (
    AICommandNotFoundError,
    AIExecutionError,
    AIRateLimitError,
    AIRequest,
    AITimeoutError,
    ClaudeCodeProvider,
)
from focara.config import Config, parse_config

# 実際の claude の代わりに使うスタブ。STUB_MODE で振る舞いを切り替え、
# 受け取った引数・標準入力・環境変数・cwd を STUB_RECORD に書き出す。
STUB = f"""#!{sys.executable}
import json, os, sys, time
record = {{
    "argv": sys.argv[1:],
    "stdin": sys.stdin.read(),
    "cwd": os.getcwd(),
    "env": dict(os.environ),
}}
with open(os.environ["STUB_RECORD"], "w") as f:
    json.dump(record, f)
mode = os.environ.get("STUB_MODE", "ok")

def emit(obj):
    print(json.dumps(obj), flush=True)

if mode == "ok":
    emit({{"type": "system", "subtype": "init"}})
    emit({{"type": "assistant", "message": {{"content": "..."}}}})
    emit({{"type": "result", "is_error": False, "result": "完了しました",
          "session_id": "11111111-1111-1111-1111-111111111111"}})
elif mode == "noise":
    print("Warning: something on stderr", file=sys.stderr, flush=True)
    print("not json {{", flush=True)
    emit({{"type": "result", "is_error": False, "result": "ノイズ混在でも取れる"}})
    print("trailing garbage", flush=True)
elif mode == "is_error":
    emit({{"type": "result", "is_error": True, "result": "something failed"}})
    sys.exit(1)
elif mode == "rate_limit":
    emit({{"type": "result", "is_error": True, "api_error_status": 429,
          "result": "Claude AI usage limit reached"}})
    sys.exit(1)
elif mode == "crash":
    print("fatal error", flush=True)
    sys.exit(3)
elif mode == "sleep":
    print("started", flush=True)
    time.sleep(60)
"""


@pytest.fixture
def stub(tmp_path: Path) -> Path:
    path = tmp_path / "claude-stub"
    path.write_text(STUB)
    path.chmod(0o755)
    return path


def make_provider(
    tmp_path: Path, stub: Path, mode: str, *, timeout: float = 30, extra_env=None
) -> ClaudeCodeProvider:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "STUB_MODE": mode,
        "STUB_RECORD": str(tmp_path / "record.json"),
        **(extra_env or {}),
    }
    return ClaudeCodeProvider(
        workdir=tmp_path / "work",
        log_dir=tmp_path / "logs" / "ai",
        claude_command=str(stub),
        timeout_seconds=timeout,
        log_retention_days=30,
        env=env,
    )


def record(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "record.json").read_text())


def test_success(tmp_path: Path, stub: Path) -> None:
    provider = make_provider(
        tmp_path,
        stub,
        "ok",
        extra_env={"ANTHROPIC_API_KEY": "secret", "CLAUDECODE": "1", "KEEP_ME": "yes"},
    )
    result = provider.run(
        AIRequest(prompt="--looks-like-option", allowed_tools=("Read", "mcp__focara__add_task"))
    )

    assert result.text == "完了しました"
    assert result.session_id == "11111111-1111-1111-1111-111111111111"
    rec = record(tmp_path)
    argv = rec["argv"]
    assert argv[:4] == ["-p", "--output-format", "stream-json", "--verbose"]
    assert "--dangerously-skip-permissions" not in argv
    assert argv[argv.index("--allowedTools") + 1] == "Read,mcp__focara__add_task"
    assert "--resume" not in argv
    assert "--session-id" in argv
    # プロンプトは引数でなく標準入力で渡す
    assert rec["stdin"] == "--looks-like-option"
    assert "--looks-like-option" not in argv
    assert Path(rec["cwd"]).resolve() == (tmp_path / "work").resolve()
    assert "ANTHROPIC_API_KEY" not in rec["env"]
    assert "CLAUDECODE" not in rec["env"]
    assert rec["env"]["KEEP_ME"] == "yes"
    # ログに出力が逐次書かれている
    assert result.log_path is not None
    assert result.log_path.parent == tmp_path / "logs" / "ai"
    assert '"type": "result"' in result.log_path.read_text()


def test_new_session_each_time(tmp_path: Path, stub: Path) -> None:
    provider = make_provider(tmp_path, stub, "ok")
    provider.run(AIRequest(prompt="a"))
    first = record(tmp_path)["argv"]
    provider.run(AIRequest(prompt="b"))
    second = record(tmp_path)["argv"]
    sid = lambda argv: argv[argv.index("--session-id") + 1]  # noqa: E731
    assert sid(first) != sid(second)


def test_resume_when_session_given(tmp_path: Path, stub: Path) -> None:
    provider = make_provider(tmp_path, stub, "ok")
    provider.run(AIRequest(prompt="続き", session_id="abc", system_prompt="追加の指示"))
    argv = record(tmp_path)["argv"]
    assert argv[argv.index("--resume") + 1] == "abc"
    assert "--session-id" not in argv
    assert argv[argv.index("--append-system-prompt") + 1] == "追加の指示"
    assert "--allowedTools" not in argv


def test_non_json_lines_are_skipped(tmp_path: Path, stub: Path) -> None:
    result = make_provider(tmp_path, stub, "noise").run(AIRequest(prompt="x"))
    assert result.text == "ノイズ混在でも取れる"
    assert "not json" in result.log_path.read_text()


def test_is_error(tmp_path: Path, stub: Path) -> None:
    with pytest.raises(AIExecutionError, match="something failed") as e:
        make_provider(tmp_path, stub, "is_error").run(AIRequest(prompt="x"))
    assert e.value.returncode == 1
    assert e.value.log_path is not None and e.value.log_path.is_file()
    assert not isinstance(e.value, AIRateLimitError)


def test_rate_limit(tmp_path: Path, stub: Path) -> None:
    with pytest.raises(AIRateLimitError, match="usage limit") as e:
        make_provider(tmp_path, stub, "rate_limit").run(AIRequest(prompt="x"))
    assert e.value.status == 429


def test_abnormal_exit_without_result(tmp_path: Path, stub: Path) -> None:
    with pytest.raises(AIExecutionError, match="終了コード 3") as e:
        make_provider(tmp_path, stub, "crash").run(AIRequest(prompt="x"))
    assert e.value.returncode == 3
    assert "fatal error" in e.value.log_path.read_text()


def test_timeout(tmp_path: Path, stub: Path) -> None:
    started = time.monotonic()
    with pytest.raises(AITimeoutError) as e:
        make_provider(tmp_path, stub, "sleep", timeout=1).run(AIRequest(prompt="x"))
    assert time.monotonic() - started < 20
    log = e.value.log_path.read_text()
    assert "started" in log
    assert "タイムアウト" in log


def test_command_not_found(tmp_path: Path) -> None:
    provider = ClaudeCodeProvider(
        workdir=tmp_path / "work",
        log_dir=tmp_path / "logs",
        claude_command=str(tmp_path / "no-such-claude"),
    )
    with pytest.raises(AICommandNotFoundError, match="no-such-claude"):
        provider.run(AIRequest(prompt="x"))


def test_old_logs_are_removed(tmp_path: Path, stub: Path) -> None:
    log_dir = tmp_path / "logs" / "ai"
    log_dir.mkdir(parents=True)
    old = log_dir / "old.log"
    recent = log_dir / "recent.log"
    old.write_text("old")
    recent.write_text("recent")
    now = time.time()
    os.utime(old, (now - 31 * 86400, now - 31 * 86400))
    os.utime(recent, (now - 29 * 86400, now - 29 * 86400))

    make_provider(tmp_path, stub, "ok").run(AIRequest(prompt="x"))

    assert not old.exists()
    assert recent.exists()
    assert len(list(log_dir.glob("*.log"))) == 2


def test_from_config() -> None:
    cfg = parse_config(
        {
            "log": {"dir": "mylogs"},
            "ai": {
                "workdir": "w",
                "claude_command": "/opt/claude",
                "timeout_seconds": 5,
                "log_retention_days": 7,
            },
        }
    )
    provider = ClaudeCodeProvider.from_config(cfg)
    assert provider.workdir == Path("w")
    assert provider.log_dir == Path("mylogs") / "ai"
    assert provider.claude_command == "/opt/claude"
    assert provider.timeout_seconds == 5
    assert provider.log_retention_days == 7
    assert ClaudeCodeProvider.from_config(Config()).claude_command == "claude"


def test_log_file_name_uses_timestamp(tmp_path: Path, stub: Path) -> None:
    provider = make_provider(tmp_path, stub, "ok")
    provider._now = lambda: datetime(2026, 1, 2, 3, 4, 5, 678)
    result = provider.run(AIRequest(prompt="x"))
    assert result.log_path.name == "20260102T030405000678.log"
