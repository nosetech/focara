import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = "../config/config.yaml"
BACKEND_HOST = "127.0.0.1"  # backend は常に 127.0.0.1 に bind する


class ConfigError(ValueError):
    """設定ファイルの内容が不正なときに送出する。"""


@dataclass(frozen=True)
class BackendConfig:
    port: int = 8800


@dataclass(frozen=True)
class FrontendConfig:
    port: int = 3800
    # 公開用の bind 先。LAN/Tailscale 公開時は 0.0.0.0 等を指定する(frontend のみに適用)。
    host: str = "127.0.0.1"


@dataclass(frozen=True)
class DbConfig:
    path: str = "data/focara.db"


@dataclass(frozen=True)
class LogConfig:
    dir: str = "logs"


@dataclass(frozen=True)
class UiConfig:
    # この時刻(時)以降、未完了が残っていると「1日の予定を終えた」画面に切り替わる。
    day_end_hour: int = 22


@dataclass(frozen=True)
class Config:
    instance: str = "default"
    backend: BackendConfig = field(default_factory=BackendConfig)
    frontend: FrontendConfig = field(default_factory=FrontendConfig)
    db: DbConfig = field(default_factory=DbConfig)
    log: LogConfig = field(default_factory=LogConfig)
    ui: UiConfig = field(default_factory=UiConfig)


def _section(raw: dict[str, Any], key: str, allowed: set[str]) -> dict[str, Any]:
    value = raw.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"{key} はマッピングで指定してください")
    unknown = set(value) - allowed
    if unknown:
        raise ConfigError(f"{key} に未知の項目があります: {', '.join(sorted(map(str, unknown)))}")
    return value


def _port(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 65535:
        raise ConfigError(f"{name} は 1〜65535 の整数で指定してください: {value!r}")
    return value


def _hour(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 23:
        raise ConfigError(f"{name} は 0〜23 の整数で指定してください: {value!r}")
    return value


def _string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{name} は空でない文字列で指定してください: {value!r}")
    return value


def parse_config(raw: Any) -> Config:
    """YAML をパースした値を検証して Config にする。不正値は ConfigError。"""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigError("設定ファイルのトップレベルはマッピングで指定してください")
    unknown = set(raw) - {"instance", "backend", "frontend", "db", "log", "ui"}
    if unknown:
        raise ConfigError(f"未知の項目があります: {', '.join(sorted(map(str, unknown)))}")

    d = Config()
    backend = _section(raw, "backend", {"port"})
    frontend = _section(raw, "frontend", {"port", "host"})
    db = _section(raw, "db", {"path"})
    log = _section(raw, "log", {"dir"})
    ui = _section(raw, "ui", {"day_end_hour"})

    cfg = Config(
        instance=_string(raw.get("instance", d.instance), "instance"),
        backend=BackendConfig(port=_port(backend.get("port", d.backend.port), "backend.port")),
        frontend=FrontendConfig(
            port=_port(frontend.get("port", d.frontend.port), "frontend.port"),
            host=_string(frontend.get("host", d.frontend.host), "frontend.host"),
        ),
        db=DbConfig(path=_string(db.get("path", d.db.path), "db.path")),
        log=LogConfig(dir=_string(log.get("dir", d.log.dir), "log.dir")),
        ui=UiConfig(
            day_end_hour=_hour(ui.get("day_end_hour", d.ui.day_end_hour), "ui.day_end_hour")
        ),
    )
    if cfg.backend.port == cfg.frontend.port:
        raise ConfigError("backend.port と frontend.port は異なる値にしてください")
    return cfg


def load_config(path: str | os.PathLike[str] | None = None) -> Config:
    """設定ファイル(引数 > FOCARA_CONFIG > ../config/config.yaml)を読む。

    ファイルが無い場合は既定値を返す。FOCARA_CONFIG で明示したファイルが無い場合はエラー。
    """
    explicit = path or os.environ.get("FOCARA_CONFIG")
    p = Path(explicit or DEFAULT_CONFIG_PATH)
    if not p.is_file():
        if explicit:
            raise ConfigError(f"設定ファイルが見つかりません: {p}")
        return Config()
    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise ConfigError(f"設定ファイルを解釈できません: {p}: {e}") from e
    return parse_config(raw)
