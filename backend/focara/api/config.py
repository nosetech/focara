from importlib.metadata import PackageNotFoundError, version
from typing import Annotated

from fastapi import APIRouter, Depends

from focara.api.deps import get_config
from focara.config import Config

router = APIRouter(prefix="/api/config", tags=["config"])


def _app_version() -> str:
    try:
        return version("focara")
    except PackageNotFoundError:
        return "unknown"


@router.get("")
def read_config(cfg: Annotated[Config, Depends(get_config)]) -> dict[str, int | str]:
    """frontend が必要とする設定値だけを返す。"""
    return {"day_end_hour": cfg.ui.day_end_hour, "version": _app_version()}
