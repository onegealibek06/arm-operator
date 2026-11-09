"""
Эмулятор бэкенда КП: генерирует воздушную обстановку и шлёт телеметрию по WebSocket.

Запуск:  python simulator.py            (10 пакетов/с)
         python simulator.py --hz 50    (стресс-тест)

WebSocket:  ws://localhost:8000/ws
Отладка (имитация сбоев сети):
  POST /debug/stall?seconds=8   — соединение живо, но данные не идут (как выдернутый кабель)
  POST /debug/drop              — сервер разрывает все соединения
  POST /debug/rate?hz=50        — сменить частоту пакетов на лету
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import itertools
import json
import math
import random
import time
from dataclasses import dataclass, field

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

# --- Параметры сцены -------------------------------------------------------

BASE_LAT, BASE_LON = 51.1694, 71.4491  # условная точка КП
RANGE_M = 10_000  # дальность обзора
ZONE_M = 2_000  # охраняемая зона
MIN_TARGETS, MAX_TARGETS = 3, 5

TARGET_TYPES = {
    # тип: (мин. скорость, макс. скорость м/с, высота м)
    "UAV": (25, 45, 400),
    "FPV": (30, 60, 80),
    "HELICOPTER": (40, 70, 300),
    "AIRCRAFT": (120, 200, 2500),
    "UNKNOWN": (10, 40, 150),
}

_id_counter = itertools.count(1)


@dataclass
class Target:
    id: str
    type: str
    x: float  # метры на восток от КП
    y: float  # метры на север от КП
    speed: float  # м/с
    course: float  # градусы, 0 = север, по часовой
    altitude: float
    attacking: bool  # летит на КП
    status: str = "TRACKING"  # TRACKING | EW_ASSIGNED | VIDEO_REQUESTED
    ew_since: float | None = None
    born: float = field(default_factory=time.monotonic)

    @property
    def distance(self) -> float:
        return math.hypot(self.x, self.y)

    @property
    def bearing_to_base(self) -> float:
        return math.degrees(math.atan2(-self.x, -self.y)) % 360

    def threat(self) -> str:
        if self.status == "EW_ASSIGNED":
            return "MEDIUM" if self.distance < ZONE_M * 1.5 else "LOW"
        diff = abs((self.course - self.bearing_to_base + 180) % 360 - 180)
        approaching = diff < 45
        if self.distance < ZONE_M * 1.5 or (approaching and self.distance < 5_000):
            return "HIGH"
        if approaching or self.distance < 6_000:
            return "MEDIUM"
        return "LOW"

    def to_json(self) -> dict:
        # Плоская проекция метров в градусы — для учебного эмулятора достаточно.
        lat = BASE_LAT + self.y / 111_320
        lon = BASE_LON + self.x / (111_320 * math.cos(math.radians(BASE_LAT)))
        return {
            "id": self.id,
            "type": self.type,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "altitude": round(self.altitude),
            "speed": round(self.speed, 1),
            "azimuth": round(self.bearing_from_base(), 1),
            "course": round(self.course, 1),
            "distance": round(self.distance),
            "threat": self.threat(),
            "status": self.status,
        }

    def bearing_from_base(self) -> float:
        return math.degrees(math.atan2(self.x, self.y)) % 360


def spawn_target() -> Target:
    ttype = random.choice(list(TARGET_TYPES))
    vmin, vmax, alt = TARGET_TYPES[ttype]
    angle = random.uniform(0, 2 * math.pi)
    r = random.uniform(RANGE_M * 0.75, RANGE_M * 0.95)
    x, y = r * math.sin(angle), r * math.cos(angle)
    attacking = random.random() < 0.55
    to_base = math.degrees(math.atan2(-x, -y)) % 360
    course = to_base + (random.uniform(-15, 15) if attacking else random.uniform(-110, 110))
    return Target(
        id=f"T-{next(_id_counter):03d}",
        type=ttype,
        x=x,
        y=y,
        speed=random.uniform(vmin, vmax),
        course=course % 360,
        altitude=alt * random.uniform(0.7, 1.3),
        attacking=attacking,
    )


# --- Мир -------------------------------------------------------------------


class World:
    def __init__(self) -> None:
        self.targets: dict[str, Target] = {}
        for _ in range(random.randint(MIN_TARGETS, MAX_TARGETS)):
            t = spawn_target()
            self.targets[t.id] = t

    def step(self, dt: float) -> None:
        now = time.monotonic()
        for t in list(self.targets.values()):
            if t.status == "EW_ASSIGNED":
                # РЭБ подавил канал управления: цель теряет скорость и уходит от КП
                away = (t.bearing_to_base + 180) % 360
                t.course += ((away - t.course + 180) % 360 - 180) * min(1.0, dt * 0.6)
                t.speed = max(8.0, t.speed * (1 - 0.15 * dt))
            elif t.attacking:
                # Атакующая цель доворачивает на КП
                d = (t.bearing_to_base - t.course + 180) % 360 - 180
                t.course += max(-8 * dt, min(8 * dt, d))
            else:
                t.course += random.uniform(-6, 6) * dt
            t.course %= 360
            rad = math.radians(t.course)
            t.x += math.sin(rad) * t.speed * dt
            t.y += math.cos(rad) * t.speed * dt

            if t.distance > RANGE_M * 1.05 or t.distance < 150 or now - t.born > 600:
                del self.targets[t.id]

        while len(self.targets) < MIN_TARGETS or (
            len(self.targets) < MAX_TARGETS and random.random() < dt * 0.05
        ):
            t = spawn_target()
            self.targets[t.id] = t

    def snapshot(self) -> list[dict]:
        return [t.to_json() for t in self.targets.values()]

    def apply_command(self, action: str, target_id: str) -> tuple[bool, str]:
        t = self.targets.get(target_id)
        if t is None:
            return False, f"Цель {target_id} не найдена (уже ушла из зоны?)"
        if action == "EW_HANDOFF":
            t.status = "EW_ASSIGNED"
            t.ew_since = time.monotonic()
            return True, f"{target_id} передана в модуль РЭБ"
        if action == "REQUEST_VIDEO":
            if t.status == "TRACKING":
                t.status = "VIDEO_REQUESTED"
            return True, f"Запрос видео по {target_id} принят ОЭС"
        if action == "DROP_TARGET":
            del self.targets[target_id]
            return True, f"Цель {target_id} сброшена с сопровождения"
        return False, f"Неизвестная команда {action}"


# --- Сервер ----------------------------------------------------------------

@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(simulation_loop())
    yield
    task.cancel()


app = FastAPI(title="ARM telemetry simulator", lifespan=lifespan)
world = World()
clients: set[WebSocket] = set()
settings = {"hz": 10.0, "stall_until": 0.0}
seq = itertools.count(1)


async def broadcast(message: dict) -> None:
    data = json.dumps(message, ensure_ascii=False)
    dead = []
    for ws in list(clients):
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def simulation_loop() -> None:
    last = time.monotonic()
    while True:
        await asyncio.sleep(1 / settings["hz"])
        now = time.monotonic()
        world.step(now - last)
        last = now
        if now < settings["stall_until"]:
            continue  # «кабель выдернут»: TCP живой, данных нет
        await broadcast(
            {
                "type": "telemetry",
                "seq": next(seq),
                "ts": int(time.time() * 1000),
                "targets": world.snapshot(),
            }
        )


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    await ws.send_text(
        json.dumps(
            {
                "type": "hello",
                "ts": int(time.time() * 1000),
                "hz": settings["hz"],
                "base": {"lat": BASE_LAT, "lon": BASE_LON},
                "rangeM": RANGE_M,
                "zoneM": ZONE_M,
            }
        )
    )
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "command":
                asyncio.create_task(handle_command(ws, msg))
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


async def handle_command(ws: WebSocket, msg: dict) -> None:
    await asyncio.sleep(random.uniform(0.15, 0.6))  # задержка исполнительного модуля
    ok, text = world.apply_command(str(msg.get("action")), str(msg.get("targetId")))
    with contextlib.suppress(Exception):
        await ws.send_text(
            json.dumps(
                {
                    "type": "ack",
                    "requestId": msg.get("requestId"),
                    "action": msg.get("action"),
                    "targetId": msg.get("targetId"),
                    "ok": ok,
                    "message": text,
                    "ts": int(time.time() * 1000),
                },
                ensure_ascii=False,
            )
        )


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "clients": len(clients), "targets": len(world.targets), **settings}


@app.post("/debug/stall")
async def debug_stall(seconds: float = 8) -> dict:
    settings["stall_until"] = time.monotonic() + seconds
    return {"stalled_for": seconds}


@app.post("/debug/drop")
async def debug_drop() -> dict:
    n = len(clients)
    for ws in list(clients):
        with contextlib.suppress(Exception):
            await ws.close(code=1012)
    clients.clear()
    return {"dropped": n}


@app.post("/debug/rate")
async def debug_rate(hz: float = 10) -> dict:
    settings["hz"] = max(1.0, min(hz, 200.0))
    return {"hz": settings["hz"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--hz", type=float, default=10.0, help="пакетов телеметрии в секунду")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    settings["hz"] = args.hz
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")
