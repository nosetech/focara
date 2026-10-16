from alembic import context

from focara.db import models  # noqa: F401  (メタデータにモデルを登録する)
from focara.db.base import Base

target_metadata = Base.metadata


def run_migrations() -> None:
    engine = context.config.attributes.get("engine")
    if engine is None:
        raise RuntimeError("engine が指定されていません。upgrade_db() 経由で実行してください")
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite の ALTER は batch mode で行う
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations()
