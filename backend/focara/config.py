import os
from pathlib import Path

import yaml

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8800


def load_config() -> dict:
    """設定ファイル(FOCARA_CONFIG、既定 ../config/config.yaml)を読む。無ければ空。"""
    path = Path(os.environ.get("FOCARA_CONFIG", "../config/config.yaml"))
    if not path.is_file():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def backend_port() -> int:
    return int(load_config().get("backend", {}).get("port", DEFAULT_PORT))
