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


@pytest.fixture
def tid(client):
    return client.post("/api/tasks", json={"title": "体重を測る"}).json()["id"]


def test_memo_roundtrip(client, tid):
    assert client.get(f"/api/tasks/{tid}/memo").json() == {"memo": None}
    assert client.put(f"/api/tasks/{tid}/memo", json={"memo": "# 朝\n- 空腹時"}).status_code == 200
    assert client.get(f"/api/tasks/{tid}/memo").json()["memo"] == "# 朝\n- 空腹時"
    assert client.get(f"/api/tasks/{tid}").json()["memo"] == "# 朝\n- 空腹時"
    assert client.put(f"/api/tasks/{tid}/memo", json={"memo": None}).json() == {"memo": None}


def test_memo_missing_task(client):
    assert client.get("/api/tasks/999/memo").status_code == 404
    assert client.put("/api/tasks/999/memo", json={"memo": "x"}).status_code == 404


def test_property_crud(client, tid):
    res = client.post(
        f"/api/tasks/{tid}/properties",
        json={"key": "体重", "value": 65.5, "value_type": "number", "unit": "kg"},
    )
    assert res.status_code == 201
    prop = res.json()
    assert (prop["value"], prop["value_type"], prop["unit"]) == ("65.5", "number", "kg")
    pid = prop["id"]
    res = client.patch(f"/api/tasks/{tid}/properties/{pid}", json={"value": 64})
    assert res.json()["value"] == "64"
    assert res.json()["unit"] == "kg"
    assert len(client.get(f"/api/tasks/{tid}/properties").json()) == 1
    assert client.delete(f"/api/tasks/{tid}/properties/{pid}").status_code == 204
    assert client.get(f"/api/tasks/{tid}/properties").json() == []
    assert client.delete(f"/api/tasks/{tid}/properties/{pid}").status_code == 404


def test_types_are_distinguished(client, tid):
    def post(**body):
        return client.post(f"/api/tasks/{tid}/properties", json=body)

    assert post(key="a", value="メモ").json()["value_type"] == "string"
    assert post(key="b", value="12", value_type="number").json()["value"] == "12"
    assert post(key="c", value="2026-10-19", value_type="date").status_code == 201
    assert post(key="d", value="abc", value_type="number").status_code == 422
    assert post(key="e", value="nan", value_type="number").status_code == 422
    assert post(key="f", value="2026-13-01", value_type="date").status_code == 422
    assert post(key="g", value=1, value_type="string").status_code == 422
    assert post(key="i", value="x", unit="kg").status_code == 422
    assert post(key="", value="x").status_code == 422


def test_duplicate_key_conflicts(client, tid):
    assert (
        client.post(f"/api/tasks/{tid}/properties", json={"key": "k", "value": "1"}).status_code
        == 201
    )
    assert (
        client.post(f"/api/tasks/{tid}/properties", json={"key": "k", "value": "2"}).status_code
        == 409
    )
    other = client.post("/api/tasks", json={"title": "b"}).json()["id"]
    assert (
        client.post(f"/api/tasks/{other}/properties", json={"key": "k", "value": "2"}).status_code
        == 201
    )


def test_update_type_and_unit(client, tid):
    pid = client.post(
        f"/api/tasks/{tid}/properties",
        json={"key": "体脂肪率", "value": "20", "value_type": "number", "unit": "%"},
    ).json()["id"]
    url = f"/api/tasks/{tid}/properties/{pid}"
    assert client.patch(url, json={"value_type": "string"}).status_code == 422
    res = client.patch(url, json={"value_type": "string", "value": "多め"})
    assert res.json()["unit"] is None
    assert client.patch(url, json={"unit": "kg"}).status_code == 422
    assert client.patch(url, json={"value": "bad", "value_type": "date"}).status_code == 422
    assert client.patch(url, json={"key": None}).status_code == 422
    assert client.patch(url, json={"key": "x"}).json()["key"] == "x"


def test_property_scoped_to_task(client, tid):
    pid = client.post(f"/api/tasks/{tid}/properties", json={"key": "k", "value": "1"}).json()["id"]
    other = client.post("/api/tasks", json={"title": "b"}).json()["id"]
    assert (
        client.patch(f"/api/tasks/{other}/properties/{pid}", json={"value": "2"}).status_code == 404
    )
    assert client.delete(f"/api/tasks/{other}/properties/{pid}").status_code == 404


def test_properties_deleted_with_task(client, tid):
    client.post(f"/api/tasks/{tid}/properties", json={"key": "k", "value": "1"})
    assert client.delete(f"/api/tasks/{tid}").status_code == 204
    assert client.get(f"/api/tasks/{tid}/properties").status_code == 404
