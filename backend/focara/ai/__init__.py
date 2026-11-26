"""AI 呼び出しの抽象化(docs/architecture.md 4章)。

呼び出し側は AIProvider / AIRequest / AIResult と例外だけを使い、
プロバイダ固有のコマンドや出力形式を知らない。
"""

from focara.ai.base import (
    AICommandNotFoundError,
    AIError,
    AIExecutionError,
    AIProvider,
    AIRateLimitError,
    AIRequest,
    AIResult,
    AITimeoutError,
)
from focara.ai.claude_code import ClaudeCodeProvider

__all__ = [
    "AICommandNotFoundError",
    "AIError",
    "AIExecutionError",
    "AIProvider",
    "AIRateLimitError",
    "AIRequest",
    "AIResult",
    "AITimeoutError",
    "ClaudeCodeProvider",
]
