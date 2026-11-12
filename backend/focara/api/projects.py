from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import case, func, select

from focara.api.deps import SessionDep
from focara.api.tasks import add_log
from focara.db.models import Project, Task
from focara.task_status import InvalidTransition, transition

# 完了にするとき、一括で完了にする対象(done / cancelled は対象外)
OPEN_STATUSES = ("inbox", "next", "waiting", "someday")

router = APIRouter(prefix="/api/projects", tags=["projects"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ProjectCreate(BaseModel):
    name: Name
    description: str | None = None


class ProjectUpdate(BaseModel):
    """部分更新。指定した項目だけ更新する。"""

    name: Name | None = None
    description: str | None = None
    # True で完了、False で未完了に戻す。未完了タスクが残るときは complete_tasks が必要
    completed: bool | None = None
    complete_tasks: bool = False


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    task_count: int = 0
    done_count: int = 0
    progress: float = 0.0


def _select_with_progress():
    """タスク件数・完了件数を集計したプロジェクトの SELECT。"""
    return (
        select(
            Project,
            # キャンセルした子は進捗の母数に含めない
            func.coalesce(
                func.sum(case((Task.id.is_(None), 0), (Task.status == "cancelled", 0), else_=1)), 0
            ),
            func.coalesce(func.sum(case((Task.status == "done", 1), else_=0)), 0),
        )
        .outerjoin(Task, Task.project_id == Project.id)
        .group_by(Project.id)
    )


def _to_out(project: Project, task_count: int, done_count: int) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.task_count = task_count
    out.done_count = done_count
    out.progress = done_count / task_count if task_count else 0.0
    return out


def _get_or_404(session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "プロジェクトが見つかりません")
    return project


def _out_for(session, project_id: int) -> ProjectOut:
    row = session.execute(_select_with_progress().where(Project.id == project_id)).one()
    return _to_out(*row)


@router.get("", response_model=list[ProjectOut])
def list_projects(session: SessionDep) -> list[ProjectOut]:
    rows = session.execute(_select_with_progress().order_by(Project.id))
    return [_to_out(*row) for row in rows]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, session: SessionDep) -> ProjectOut:
    _get_or_404(session, project_id)
    return _out_for(session, project_id)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, session: SessionDep) -> ProjectOut:
    project = Project(**body.model_dump())
    session.add(project)
    session.commit()
    return _out_for(session, project.id)


def _set_completed(session, project: Project, completed: bool, complete_tasks: bool) -> None:
    """完了・未完了を切り替える。未完了タスクの一括完了も同じトランザクションで行う。"""
    if not completed:
        project.completed_at = None
        return
    if project.completed_at is not None:
        return
    open_tasks = session.scalars(
        select(Task).where(Task.project_id == project.id, Task.status.in_(OPEN_STATUSES))
    ).all()
    if open_tasks and not complete_tasks:
        raise HTTPException(
            409,
            {
                "message": "未完了のタスクが残っています",
                "open_task_count": len(open_tasks),
            },
        )
    try:
        for task in open_tasks:
            transition(task, "done")
            add_log(session, task, "completed")
    except InvalidTransition as e:
        session.rollback()
        raise HTTPException(409, str(e)) from e
    project.completed_at = datetime.now(UTC)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectUpdate, session: SessionDep) -> ProjectOut:
    project = _get_or_404(session, project_id)
    values = body.model_dump(exclude_unset=True, exclude={"completed", "complete_tasks"})
    if "name" in values and values["name"] is None:
        raise HTTPException(422, "name は null にできません")
    if body.completed is not None:
        _set_completed(session, project, body.completed, body.complete_tasks)
    for key, value in values.items():
        setattr(project, key, value)
    session.commit()
    return _out_for(session, project_id)


class TaskOrder(BaseModel):
    task_ids: list[int]


@router.put("/{project_id}/task-order", status_code=204)
def reorder_tasks(project_id: int, body: TaskOrder, session: SessionDep) -> Response:
    """所属タスク全件の並び順を task_ids の順に設定する。過不足・重複する ID は 422。"""
    _get_or_404(session, project_id)
    if len(set(body.task_ids)) != len(body.task_ids):
        raise HTTPException(422, "task_ids が重複しています")
    tasks = session.scalars(select(Task).where(Task.project_id == project_id)).all()
    if {t.id for t in tasks} != set(body.task_ids):
        raise HTTPException(422, "task_ids は所属タスクの全件を指定してください")
    by_id = {t.id: t for t in tasks}
    for i, task_id in enumerate(body.task_ids):
        by_id[task_id].project_order = i
    session.commit()
    return Response(status_code=204)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, session: SessionDep) -> Response:
    """プロジェクトのみ削除する。所属タスクは残り、project_id が NULL になる。"""
    session.delete(_get_or_404(session, project_id))
    session.commit()
    return Response(status_code=204)
