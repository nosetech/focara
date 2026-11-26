"""Claude Code CLI(claude -p)によるプロバイダ。

producer-desk の orchestrator/orchestrator/agent_runner.py の実行方式に合わせる。
- リクエストごとにワンショット起動し、常駐させない。プロンプトは標準入力で渡す。
- --output-format stream-json --verbose の NDJSON から最後の result イベントを結果とする。
- 権限は --dangerously-skip-permissions を使わず --allowedTools で限定する。
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
import uuid
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path

from focara.ai.base import (
    AICommandNotFoundError,
    AIExecutionError,
    AIProvider,
    AIRateLimitError,
    AIRequest,
    AIResult,
    AITimeoutError,
)
from focara.config import Config

# 子プロセスへ引き継がない環境変数。
# - API キー・接続先: サブスクリプションの Claude Code を使い、API キーでは課金させない。
# - CLAUDECODE 等: Claude Code の中から起動された場合の入れ子判定を持ち込まない。
# - FOCARA_CONFIG: AI 側が Focara の設定を参照する理由がない。
STRIPPED_ENV_KEYS = frozenset(
    {
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SSE_PORT",
        "FOCARA_CONFIG",
    }
)

RATE_LIMIT_STATUSES = frozenset({429})
# タイムアウト時、SIGTERM 後にこの秒数待っても終わらなければ SIGKILL する。
_KILL_GRACE_SECONDS = 5
_SECONDS_PER_DAY = 86400


def child_env(base: Mapping[str, str] | None = None) -> dict[str, str]:
    source = os.environ if base is None else base
    return {k: v for k, v in source.items() if k not in STRIPPED_ENV_KEYS}


def parse_result_event(lines: list[str]) -> dict | None:
    """NDJSON の各行から最後の "type":"result" イベントを返す。JSON でない行は飛ばす。"""
    payload: dict | None = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("type") == "result":
            payload = data
    return payload


def cleanup_old_logs(log_dir: Path, retention_days: int, now: float) -> None:
    """保持日数を超えて更新のない実行ログを削除する(mtime 基準。実行中のログは消えない)。"""
    if not log_dir.is_dir():
        return
    cutoff = now - retention_days * _SECONDS_PER_DAY
    for path in log_dir.glob("*.log"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except FileNotFoundError:
            pass


class ClaudeCodeProvider(AIProvider):
    def __init__(
        self,
        *,
        workdir: str | os.PathLike[str],
        log_dir: str | os.PathLike[str],
        claude_command: str = "claude",
        timeout_seconds: float = 600,
        log_retention_days: int = 30,
        env: Mapping[str, str] | None = None,
        now: Callable[[], datetime] = datetime.now,
    ) -> None:
        self.workdir = Path(workdir)
        self.log_dir = Path(log_dir)
        self.claude_command = claude_command
        self.timeout_seconds = timeout_seconds
        self.log_retention_days = log_retention_days
        self._env = env
        self._now = now

    @classmethod
    def from_config(cls, config: Config) -> ClaudeCodeProvider:
        return cls(
            workdir=config.ai.workdir,
            log_dir=Path(config.log.dir) / "ai",
            claude_command=config.ai.claude_command,
            timeout_seconds=config.ai.timeout_seconds,
            log_retention_days=config.ai.log_retention_days,
        )

    def build_command(self, request: AIRequest, session_id: str) -> list[str]:
        command = [
            self.claude_command,
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",  # -p で stream-json を使うときは必須
        ]
        if request.allowed_tools:
            command += ["--allowedTools", ",".join(request.allowed_tools)]
        if request.system_prompt:
            command += ["--append-system-prompt", request.system_prompt]
        if request.session_id:
            command += ["--resume", session_id]
        else:
            command += ["--session-id", session_id]
        return command

    def run(self, request: AIRequest) -> AIResult:
        session_id = request.session_id or str(uuid.uuid4())
        command = self.build_command(request, session_id)

        started = self._now()
        self.log_dir.mkdir(parents=True, exist_ok=True)
        cleanup_old_logs(self.log_dir, self.log_retention_days, started.timestamp())
        log_path = self.log_dir / f"{started.strftime('%Y%m%dT%H%M%S%f')}.log"
        self.workdir.mkdir(parents=True, exist_ok=True)

        with log_path.open("a", encoding="utf-8") as log:
            log.write(f"session: {session_id}\ncommand: {' '.join(command)}\n")
            log.flush()
            try:
                process = subprocess.Popen(
                    command,
                    cwd=self.workdir,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                    env=child_env(self._env),
                    # タイムアウト時に孫プロセスごと止められるよう、別プロセスグループにする
                    start_new_session=True,
                )
            except (FileNotFoundError, PermissionError) as e:
                log.write(f"起動失敗: {e}\n")
                raise AICommandNotFoundError(
                    f"AI のコマンドを起動できません: {self.claude_command}: {e}",
                    log_path=log_path,
                    session_id=session_id,
                ) from e

            lines: list[str] = []
            reader = threading.Thread(
                target=_pump, args=(process, log, lines), name="claude-output", daemon=True
            )
            reader.start()
            # 大きなプロンプトで書き込みが詰まってもタイムアウト判定できるよう、別スレッドで書く
            threading.Thread(
                target=_write_prompt, args=(process, request.prompt), daemon=True
            ).start()
            try:
                returncode = process.wait(timeout=self.timeout_seconds)
            except subprocess.TimeoutExpired:
                _terminate(process)
                reader.join()
                log.write(f"タイムアウト: {self.timeout_seconds} 秒を超えたため停止しました\n")
                raise AITimeoutError(
                    f"AI の実行が {self.timeout_seconds} 秒を超えたため停止しました",
                    log_path=log_path,
                    session_id=session_id,
                ) from None
            # 本体の終了後も孫プロセスが標準出力を握ったまま残ると読み取りが終わらないため、
            # 同じプロセスグループの残りを止めてから読み取りを待つ
            _terminate(process)
            reader.join(timeout=_KILL_GRACE_SECONDS)
            log.write(f"exit: {returncode}\n")

        return _to_result(parse_result_event(lines), returncode, session_id, log_path)


def _pump(process: subprocess.Popen, log, lines: list[str]) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        log.write(line)
        log.flush()
        lines.append(line)


def _write_prompt(process: subprocess.Popen, prompt: str) -> None:
    # プロンプトは引数でなく標準入力で渡す(先頭が "-" だとオプションと解釈されるため)
    assert process.stdin is not None
    try:
        process.stdin.write(prompt)
        process.stdin.close()
    except (BrokenPipeError, OSError):
        # 子プロセスが入力を読まずに終了した。結果は終了コード・出力で判定する。
        pass


def _terminate(process: subprocess.Popen) -> None:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=_KILL_GRACE_SECONDS)
            return
        except subprocess.TimeoutExpired:
            continue


def _to_result(payload: dict | None, returncode: int, session_id: str, log_path: Path) -> AIResult:
    common = {"log_path": log_path, "session_id": session_id}
    if payload is None:
        raise AIExecutionError(
            f"AI の結果を取得できませんでした(終了コード {returncode})",
            returncode=returncode,
            **common,
        )

    text = payload.get("result")
    text = text if isinstance(text, str) else ""
    status = payload.get("api_error_status")
    status = status if isinstance(status, int) and not isinstance(status, bool) else None

    if payload.get("is_error") or returncode != 0:
        detail = text or "(エラー内容なし)"
        if status in RATE_LIMIT_STATUSES:
            raise AIRateLimitError(
                f"AI の利用上限に達しました(status {status}): {detail}", status=status, **common
            )
        raise AIExecutionError(
            f"AI の実行が失敗しました(終了コード {returncode}"
            + (f", status {status}" if status is not None else "")
            + f"): {detail}",
            returncode=returncode,
            status=status,
            **common,
        )

    result_session = payload.get("session_id")
    return AIResult(
        text=text,
        session_id=result_session if isinstance(result_session, str) else session_id,
        log_path=log_path,
        raw=payload,
    )
