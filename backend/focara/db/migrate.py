from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def make_alembic_config(engine: Engine) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["engine"] = engine
    return cfg


def upgrade_db(engine: Engine, revision: str = "head") -> None:
    """DB を指定のリビジョン(既定は最新)までマイグレーションする。"""
    command.upgrade(make_alembic_config(engine), revision)
