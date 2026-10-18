import pytest
from fastapi.testclient import TestClient

from focara.api.deps import get_engine
from focara.db import create_db_engine, upgrade_db
from focara.main import app


@pytest.fixture
def client(tmp_path):
    engine = create_db_engine(tmp_path / "focara.db")
    upgrade_db(engine)
    app.dependency_overrides[get_engine] = lambda: engine
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.dispose()


def test_create_with_title_only_is_inbox(client):
    res = client.post("/api/tasks", json={"title": "牛乳を買う"})
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "inbox"
    assert body["title"] == "牛乳を買う"
    assert body["scheduled_date"] is None


def test_crud_roundtrip(client):
    tid = client.post("/api/tasks", json={"title": "a"}).json()["id"]
    assert client.get(f"/api/tasks/{tid}").json()["title"] == "a"
    res = client.patch(
        f"/api/tasks/{tid}",
        json={"status": "next", "scheduled_date": "2026-10-20", "time_slot": "morning"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "next"
    assert res.json()["scheduled_date"] == "2026-10-20"
    assert res.json()["title"] == "a"
    assert client.delete(f"/api/tasks/{tid}").status_code == 204
    assert client.get(f"/api/tasks/{tid}").status_code == 404
    assert client.delete(f"/api/tasks/{tid}").status_code == 404


def test_patch_can_clear_field(client):
    tid = client.post("/api/tasks", json={"title": "a", "memo": "m"}).json()["id"]
    assert client.patch(f"/api/tasks/{tid}", json={"memo": None}).json()["memo"] is None


def test_list_filters(client):
    client.post("/api/tasks", json={"title": "a"})
    client.post("/api/tasks", json={"title": "b", "status": "next", "scheduled_date": "2026-10-20"})
    assert len(client.get("/api/tasks").json()) == 2
    assert [t["title"] for t in client.get("/api/tasks?status=next").json()] == ["b"]
    assert [t["title"] for t in client.get("/api/tasks?scheduled_date=2026-10-20").json()] == ["b"]
    assert client.get("/api/tasks?scheduled_date=2026-10-21").json() == []
    assert client.get("/api/tasks?project_id=1").json() == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": ""},
        {"title": "  "},
        {"title": "a", "status": "bogus"},
        {"title": "a", "time_slot": "night"},
        {"title": "a", "fixed_at": "2026-10-20T10:00:00"},
        {"title": "a", "project_id": 999},
        {"title": "a", "recurrence_type": "weekly"},
    ],
)
def test_create_validation(client, body):
    assert client.post("/api/tasks", json=body).status_code == 422


def test_update_validation(client):
    tid = client.post("/api/tasks", json={"title": "a"}).json()["id"]
    assert client.patch(f"/api/tasks/{tid}", json={"status": "bogus"}).status_code == 422
    assert client.patch(f"/api/tasks/{tid}", json={"title": None}).status_code == 422
    assert client.patch(f"/api/tasks/{tid}", json={"recurrence_end_type": None}).status_code == 422
    assert client.patch("/api/tasks/999", json={"title": "x"}).status_code == 404
    assert client.get(f"/api/tasks/{tid}").json()["title"] == "a"


def test_recurrence(client):
    res = client.post(
        "/api/tasks",
        json={
            "title": "r",
            "status": "habit",
            "recurrence_type": "weekly",
            "recurrence_weekdays": 2,
        },
    )
    assert res.status_code == 201


def test_openapi(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/tasks" in paths and "/api/tasks/{task_id}" in paths


def _make(client, **kw):
    return client.post("/api/tasks", json={"title": "t", **kw}).json()["id"]


@pytest.mark.parametrize("target", ["next", "someday", "habit", "done"])
def test_transition_from_inbox(client, target):
    tid = _make(client)
    res = client.post(f"/api/tasks/{tid}/transition", json={"status": target})
    assert res.status_code == 200
    assert res.json()["status"] == target


def test_transition_to_waiting_keeps_condition_and_clears_on_leave(client):
    tid = _make(client)
    res = client.post(
        f"/api/tasks/{tid}/transition",
        json={
            "status": "waiting",
            "wait_condition": "田中さんの返信",
            "wait_until": "2026-10-20T00:00:00Z",
        },
    )
    assert res.status_code == 200
    assert res.json()["wait_condition"] == "田中さんの返信"
    assert res.json()["wait_until"] == "2026-10-20T00:00:00Z"
    res = client.post(f"/api/tasks/{tid}/transition", json={"status": "next"})
    assert res.json()["wait_condition"] is None
    assert res.json()["wait_until"] is None


def test_transition_to_waiting_requires_condition(client):
    tid = _make(client)
    res = client.post(f"/api/tasks/{tid}/transition", json={"status": "waiting"})
    assert res.status_code == 422
    assert client.get(f"/api/tasks/{tid}").json()["status"] == "inbox"
    assert client.post("/api/tasks", json={"title": "x", "status": "waiting"}).status_code == 422


def test_invalid_transitions_rejected(client):
    tid = _make(client)
    assert client.post(f"/api/tasks/{tid}/transition", json={"status": "inbox"}).status_code == 409
    client.post(f"/api/tasks/{tid}/transition", json={"status": "done"})
    assert (
        client.post(f"/api/tasks/{tid}/transition", json={"status": "someday"}).status_code == 409
    )
    assert client.patch(f"/api/tasks/{tid}", json={"status": "habit"}).status_code == 409
    assert client.post(f"/api/tasks/{tid}/transition", json={"status": "next"}).status_code == 200
    assert (
        client.post(
            f"/api/tasks/{tid}/transition", json={"status": "next", "wait_condition": "x"}
        ).status_code
        == 422
    )


def test_release_due_waiting(client):
    from datetime import UTC, datetime

    from sqlalchemy.orm import Session

    from focara.task_status import release_due_waiting

    past = _make(client, status="waiting", wait_until="2026-10-01T00:00:00Z")
    future = _make(client, status="waiting", wait_until="2099-01-01T00:00:00Z")
    person = _make(client, status="waiting", wait_condition="返信待ち")
    engine = app.dependency_overrides[get_engine]()
    with Session(engine) as s:
        assert release_due_waiting(s, datetime(2026, 10, 18, tzinfo=UTC)) == 1
    assert client.get(f"/api/tasks/{past}").json()["status"] == "next"
    assert client.get(f"/api/tasks/{past}").json()["wait_until"] is None
    assert client.get(f"/api/tasks/{future}").json()["status"] == "waiting"
    assert client.get(f"/api/tasks/{person}").json()["status"] == "waiting"


def test_wait_fields_only_for_waiting(client):
    assert client.post("/api/tasks", json={"title": "x", "wait_condition": "a"}).status_code == 422
    tid = _make(client)
    assert (
        client.patch(f"/api/tasks/{tid}", json={"wait_until": "2026-10-01T00:00:00Z"}).status_code
        == 422
    )
    res = client.patch(f"/api/tasks/{tid}", json={"status": "waiting", "wait_condition": "a"})
    assert res.status_code == 200
