"""AIProvider インターフェースと、プロバイダ共通の入出力・例外。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class AIRequest:
    """AI への1回の依頼。

    session_id を渡したときだけ、そのセッションを継続する(省略時は毎回新規)。
    allowed_tools は AI に使わせるツールの許可リスト(空なら許可なし)。
    """

    prompt: str
    allowed_tools: tuple[str, ...] = ()
    session_id: str | None = None
    system_prompt: str | None = None


@dataclass(frozen=True)
class AIResult:
    text: str
    # 次回 AIRequest.session_id に渡すと文脈を継続できる。
    session_id: str
    log_path: Path | None = None
    raw: dict = field(default_factory=dict, repr=False)


class AIError(Exception):
    """AI 実行の失敗。種別ごとのサブクラスで送出する。"""

    def __init__(
        self, message: str, *, log_path: Path | None = None, session_id: str | None = None
    ) -> None:
        super().__init__(message)
        self.message = message
        self.log_path = log_path
        self.session_id = session_id

    def __str__(self) -> str:
        if self.log_path is None:
            return self.message
        return f"{self.message} (ログ: {self.log_path})"


class AICommandNotFoundError(AIError):
    """AI のコマンドが見つからない・起動できない。"""


class AITimeoutError(AIError):
    """設定の上限秒数を超えたため停止した。"""


class AIRateLimitError(AIError):
    """利用上限に達した(429 等)。"""

    def __init__(self, message: str, *, status: int | None = None, **kwargs) -> None:
        super().__init__(message, **kwargs)
        self.status = status


class AIExecutionError(AIError):
    """AI がエラーを返した、異常終了した、または結果を取得できなかった。"""

    def __init__(
        self,
        message: str,
        *,
        returncode: int | None = None,
        status: int | None = None,
        **kwargs,
    ) -> None:
        super().__init__(message, **kwargs)
        self.returncode = returncode
        self.status = status


class AIProvider(ABC):
    @abstractmethod
    def run(self, request: AIRequest) -> AIResult:
        """依頼を実行して結果を返す。失敗時は AIError のサブクラスを送出する。"""
