from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from focara.config import Config, load_config
from focara.db import create_db_engine


@lru_cache
def get_config() -> Config:
    return load_config()


@lru_cache
def get_engine() -> Engine:
    return create_db_engine(get_config().db.path)


def get_session(engine: Annotated[Engine, Depends(get_engine)]) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
