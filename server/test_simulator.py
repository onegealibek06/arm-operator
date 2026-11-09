import math

from fastapi.testclient import TestClient

import simulator
from simulator import RANGE_M, World, app, spawn_target


def test_world_keeps_3_to_5_targets_inside_range():
    w = World()
    for _ in range(3000):  # ~5 минут симуляции
        w.step(0.1)
        assert 3 <= len(w.targets) <= 5
        for t in w.targets.values():
            assert t.distance <= RANGE_M * 1.06


def test_target_json_has_all_fields_from_spec():
    data = spawn_target().to_json()
    for key in ("id", "type", "x", "y", "lat", "lon", "speed", "azimuth", "threat"):
        assert key in data
    assert data["threat"] in {"HIGH", "MEDIUM", "LOW"}
    assert all(math.isfinite(data[k]) for k in ("x", "y", "lat", "lon", "speed", "azimuth"))


def test_commands():
    w = World()
    tid = next(iter(w.targets))
    assert w.apply_command("EW_HANDOFF", tid) == (True, f"{tid} передана в модуль РЭБ")
    assert w.targets[tid].status == "EW_ASSIGNED"
    ok, _ = w.apply_command("DROP_TARGET", tid)
    assert ok and tid not in w.targets
    ok, msg = w.apply_command("DROP_TARGET", tid)
    assert not ok and "не найдена" in msg
    ok, _ = w.apply_command("SELF_DESTRUCT", next(iter(w.targets)))
    assert not ok


def test_websocket_hello_telemetry_and_ack():
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        tel = ws.receive_json()
        assert tel["type"] == "telemetry" and 3 <= len(tel["targets"]) <= 5
        tid = tel["targets"][0]["id"]
        ws.send_json({"type": "command", "requestId": "r-1", "action": "REQUEST_VIDEO", "targetId": tid})
        ws.send_text("garbage")  # битое сообщение не должно ронять сервер
        while (msg := ws.receive_json())["type"] != "ack":
            pass
        assert msg["requestId"] == "r-1" and msg["ok"] is True


def test_debug_endpoints():
    with TestClient(app) as client:
        assert client.get("/health").json()["ok"] is True
        assert client.post("/debug/rate?hz=500").json()["hz"] == 200.0  # ограничение сверху
        client.post("/debug/rate?hz=10")
        assert client.post("/debug/stall?seconds=1").json()["stalled_for"] == 1.0
    simulator.settings["stall_until"] = 0.0
