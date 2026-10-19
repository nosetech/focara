import math
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from focara.api.deps import SessionDep
from focara.db.models import Task, TaskProperty

router = APIRouter(prefix="/api/tasks/{task_id}", tags=["properties"])

PropertyType = Literal["string", "number", "date"]
Key = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class MemoBody(BaseModel):
    memo: str | None = None


class PropertyCreate(BaseModel):
    key: Key
    value: str | int | float
    value_type: PropertyType = "string"
    unit: str | None = None


class PropertyUpdate(BaseModel):
    """部分更新。種別を変えるときは value も合わせて指定する。"""

    key: Key | None = None
    value: str | int | float | None = None
    value_type: PropertyType | None = None
    unit: str | None = None


class PropertyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    key: str
    value: str | None
    value_type: PropertyType
    unit: str | None


def _task_or_404(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "タスクが見つかりません")
    return task


def _property_or_404(session: Session, task_id: int, property_id: int) -> TaskProperty:
    prop = session.get(TaskProperty, property_id)
    if prop is None or prop.task_id != task_id:
        raise HTTPException(404, "プロパティが見つかりません")
    return prop


def _normalize(value: str | int | float, value_type: str) -> str:
    """種別に応じて値を検証し、保存用の文字列に正規化する。"""
    if value_type == "number":
        try:
            num = float(value)
        except ValueError:
            raise HTTPException(422, "数値プロパティの値が不正です") from None
        if not math.isfinite(num):
            raise HTTPException(422, "数値プロパティの値が不正です")
        return str(int(num)) if num.is_integer() else repr(num)
    if not isinstance(value, str):
        raise HTTPException(422, f"{value_type} プロパティの値は文字列で指定してください")
    if value_type == "date":
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            raise HTTPException(422, "日付プロパティの値は YYYY-MM-DD で指定してください") from None
    return value


def _normalize_unit(unit: str | None, value_type: str) -> str | None:
    unit = unit.strip() if unit else None
    if unit and value_type != "number":
        raise HTTPException(422, "単位は数値プロパティにのみ指定できます")
    return unit or None


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "同じキーのプロパティが既にあります") from None


@router.get("/memo", response_model=MemoBody)
def get_memo(task_id: int, session: SessionDep) -> Task:
    return _task_or_404(session, task_id)


@router.put("/memo", response_model=MemoBody)
def put_memo(task_id: int, body: MemoBody, session: SessionDep) -> Task:
    task = _task_or_404(session, task_id)
    task.memo = body.memo
    session.commit()
    return task


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(task_id: int, session: SessionDep) -> list[TaskProperty]:
    _task_or_404(session, task_id)
    return list(
        session.scalars(
            select(TaskProperty).where(TaskProperty.task_id == task_id).order_by(TaskProperty.id)
        )
    )


@router.post("/properties", response_model=PropertyOut, status_code=201)
def create_property(task_id: int, body: PropertyCreate, session: SessionDep) -> TaskProperty:
    _task_or_404(session, task_id)
    prop = TaskProperty(
        task_id=task_id,
        key=body.key,
        value=_normalize(body.value, body.value_type),
        value_type=body.value_type,
        unit=_normalize_unit(body.unit, body.value_type),
    )
    session.add(prop)
    _commit(session)
    return prop


@router.patch("/properties/{property_id}", response_model=PropertyOut)
def update_property(
    task_id: int, property_id: int, body: PropertyUpdate, session: SessionDep
) -> TaskProperty:
    prop = _property_or_404(session, task_id, property_id)
    values = body.model_dump(exclude_unset=True)
    for name in ("key", "value", "value_type"):
        if name in values and values[name] is None:
            raise HTTPException(422, f"{name} は null にできません")
    new_type = values.get("value_type", prop.value_type)
    if new_type != prop.value_type and "value" not in values:
        raise HTTPException(422, "種別を変更するときは value も指定してください")
    if "key" in values:
        prop.key = values["key"]
    if "value" in values:
        prop.value = _normalize(values["value"], new_type)
    prop.value_type = new_type
    if "unit" in values:
        prop.unit = _normalize_unit(values["unit"], new_type)
    elif new_type != "number":
        prop.unit = None
    _commit(session)
    return prop


@router.delete("/properties/{property_id}", status_code=204)
def delete_property(task_id: int, property_id: int, session: SessionDep) -> Response:
    session.delete(_property_or_404(session, task_id, property_id))
    session.commit()
    return Response(status_code=204)
