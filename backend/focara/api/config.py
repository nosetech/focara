from typing import Annotated

from fastapi import APIRouter, Depends

from focara.api.deps import get_config
from focara.config import Config

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
def read_config(cfg: Annotated[Config, Depends(get_config)]) -> dict[str, int]:
    """frontend が必要とする設定値だけを返す。"""
    return {"day_end_hour": cfg.ui.day_end_hour}
