import pytest
from fastapi.testclient import TestClient

from focara.api.deps import get_config, get_engine
from focara.config import Config
from focara.db import create_db_engine, upgrade_db
from focara.main import app


@pytest.fixture
def client(tmp_path):
    engine = create_db_engine(tmp_path / "focara.db")
    upgrade_db(engine)
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_config] = lambda: Config()
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.dispose()


def test_crud_roundtrip(client):
    res = client.post("/api/projects", json={"name": "引越し", "description": "d"})
    assert res.status_code == 201
    pid = res.json()["id"]
    assert res.json()["task_count"] == 0
    assert res.json()["progress"] == 0.0
    res = client.patch(f"/api/projects/{pid}", json={"name": "新居"})
    assert res.json()["name"] == "新居"
    assert res.json()["description"] == "d"
    assert (
        client.patch(f"/api/projects/{pid}", json={"description": None}).json()["description"]
        is None
    )
    assert client.get(f"/api/projects/{pid}").json()["name"] == "新居"
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
    assert client.delete(f"/api/projects/{pid}").status_code == 404
    assert client.patch(f"/api/projects/{pid}", json={"name": "x"}).status_code == 404


def test_validation(client):
    assert client.post("/api/projects", json={"name": "  "}).status_code == 422
    pid = client.post("/api/projects", json={"name": "a"}).json()["id"]
    assert client.patch(f"/api/projects/{pid}", json={"name": None}).status_code == 422


def test_list_includes_progress(client):
    pid = client.post("/api/projects", json={"name": "a"}).json()["id"]
    empty = client.post("/api/projects", json={"name": "b"}).json()["id"]
    for _ in range(3):
        client.post("/api/tasks", json={"title": "t", "project_id": pid})
    done = client.post("/api/tasks", json={"title": "d", "project_id": pid}).json()["id"]
    client.patch(f"/api/tasks/{done}", json={"status": "done"})
    rows = {p["id"]: p for p in client.get("/api/projects").json()}
    assert rows[pid]["task_count"] == 4
    assert rows[pid]["done_count"] == 1
    assert rows[pid]["progress"] == 0.25
    assert rows[empty]["task_count"] == 0
    assert rows[empty]["progress"] == 0.0


def test_assign_and_unassign_task(client):
    pid = client.post("/api/projects", json={"name": "a"}).json()["id"]
    tid = client.post("/api/tasks", json={"title": "t"}).json()["id"]
    res = client.patch(f"/api/tasks/{tid}", json={"project_id": pid})
    assert res.json()["project_id"] == pid
    assert client.get("/api/tasks", params={"project_id": pid}).json()[0]["id"] == tid
    assert client.get(f"/api/projects/{pid}").json()["task_count"] == 1
    res = client.patch(f"/api/tasks/{tid}", json={"project_id": None})
    assert res.json()["project_id"] is None
    assert client.get(f"/api/projects/{pid}").json()["task_count"] == 0


def test_assign_to_missing_project_is_422(client):
    tid = client.post("/api/tasks", json={"title": "t"}).json()["id"]
    assert client.patch(f"/api/tasks/{tid}", json={"project_id": 999}).status_code == 422


def test_delete_project_keeps_tasks(client):
    pid = client.post("/api/projects", json={"name": "a"}).json()["id"]
    tid = client.post("/api/tasks", json={"title": "t", "project_id": pid}).json()["id"]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    task = client.get(f"/api/tasks/{tid}").json()
    assert task["project_id"] is None


def test_reorder_tasks(client):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    other = client.post("/api/projects", json={"name": "Q"}).json()["id"]
    ids = [
        client.post("/api/tasks", json={"title": f"t{i}", "project_id": pid}).json()["id"]
        for i in range(3)
    ]
    outsider = client.post("/api/tasks", json={"title": "x", "project_id": other}).json()["id"]
    order = [ids[2], ids[0], ids[1]]
    res = client.put(f"/api/projects/{pid}/task-order", json={"task_ids": order})
    assert res.status_code == 204
    listed = client.get("/api/tasks", params={"project_id": pid}).json()
    assert [t["id"] for t in listed] == order
    # 所属外・重複・一部だけの指定は拒否
    res = client.put(f"/api/projects/{pid}/task-order", json={"task_ids": order[:2]})
    assert res.status_code == 422
    res = client.put(f"/api/projects/{pid}/task-order", json={"task_ids": [outsider]})
    assert res.status_code == 422
    res = client.put(f"/api/projects/{pid}/task-order", json={"task_ids": [ids[0], ids[0]]})
    assert res.status_code == 422
    assert client.put("/api/projects/999/task-order", json={"task_ids": []}).status_code == 404
    # プロジェクトを変えると並び順はリセットされる
    client.patch(f"/api/tasks/{ids[2]}", json={"project_id": other})
    assert client.get(f"/api/tasks/{ids[2]}").json()["project_order"] is None


def _task(client, pid, status="next", **kw):
    res = client.post("/api/tasks", json={"title": "t", "status": status, "project_id": pid, **kw})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_new_project_is_not_completed(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    assert client.get(f"/api/projects/{pid}").json()["completed_at"] is None
    assert client.get("/api/projects").json()[0]["completed_at"] is None


def test_complete_without_open_tasks_and_reopen(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    _task(client, pid, "done")
    res = client.patch(f"/api/projects/{pid}", json={"completed": True})
    assert res.status_code == 200
    assert res.json()["completed_at"] is not None
    res = client.patch(f"/api/projects/{pid}", json={"completed": False})
    assert res.json()["completed_at"] is None


def test_complete_with_open_tasks_requires_confirmation(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    t1 = _task(client, pid, "next")
    _task(client, pid, "someday")
    _task(client, pid, "done")
    res = client.patch(f"/api/projects/{pid}", json={"completed": True})
    assert res.status_code == 409
    assert res.json()["detail"]["open_task_count"] == 2
    assert client.get(f"/api/projects/{pid}").json()["completed_at"] is None
    assert client.get(f"/api/tasks/{t1}").json()["status"] == "next"


def test_complete_tasks_completes_open_tasks_with_log(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    t1 = _task(client, pid, "next")
    t2 = _task(client, pid, "inbox")
    res = client.patch(f"/api/projects/{pid}", json={"completed": True, "complete_tasks": True})
    assert res.status_code == 200
    assert res.json()["completed_at"] is not None
    assert res.json()["done_count"] == 2
    for t in (t1, t2):
        assert client.get(f"/api/tasks/{t}").json()["status"] == "done"
    logs = client.get("/api/logs").json()
    assert len(logs) == 2
    assert {log["action"] for log in logs} == {"completed"}


def test_complete_failure_rolls_back(client, monkeypatch):
    from focara.api import projects as mod
    from focara.task_status import InvalidTransition, transition

    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    t1 = _task(client, pid, "next")
    _task(client, pid, "inbox")
    calls = []

    def flaky(task, status):
        if calls:
            raise InvalidTransition("boom")
        calls.append(task.id)
        transition(task, status)

    monkeypatch.setattr(mod, "transition", flaky)
    res = client.patch(f"/api/projects/{pid}", json={"completed": True, "complete_tasks": True})
    assert res.status_code == 409
    assert client.get(f"/api/projects/{pid}").json()["completed_at"] is None
    assert client.get(f"/api/tasks/{t1}").json()["status"] == "next"


def test_cannot_assign_to_completed_project(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    other = client.post("/api/projects", json={"name": "o"}).json()["id"]
    existing = _task(client, pid, "done")
    free = client.post("/api/tasks", json={"title": "f"}).json()["id"]
    client.patch(f"/api/projects/{pid}", json={"completed": True})
    assert client.post("/api/tasks", json={"title": "x", "project_id": pid}).status_code == 422
    assert client.patch(f"/api/tasks/{free}", json={"project_id": pid}).status_code == 422
    # すでに属しているタスクの更新(project_id を変えない)は拒否しない
    assert client.patch(f"/api/tasks/{existing}", json={"title": "y"}).status_code == 200
    assert client.patch(f"/api/tasks/{existing}", json={"project_id": pid}).status_code == 200
    # 他のプロジェクトへは移せる
    assert client.patch(f"/api/tasks/{existing}", json={"project_id": other}).status_code == 200
    # 未完了に戻せば再び割り当てられる
    client.patch(f"/api/projects/{pid}", json={"completed": False})
    assert client.patch(f"/api/tasks/{free}", json={"project_id": pid}).status_code == 200


def test_cannot_assign_habit_to_completed_project(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    client.patch(f"/api/projects/{pid}", json={"completed": True})
    body = {"title": "h", "recurrence_type": "weekly", "recurrence_weekdays": 127}
    assert client.post("/api/habits", json={**body, "project_id": pid}).status_code == 422
    hid = client.post("/api/habits", json=body).json()["id"]
    assert client.patch(f"/api/habits/{hid}", json={"project_id": pid}).status_code == 422
