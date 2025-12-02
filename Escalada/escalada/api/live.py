# escalada/api/live.py
from fastapi import APIRouter
from pydantic import BaseModel
from starlette.websockets import WebSocket

# state per boxId
from typing import Dict
from fastapi import HTTPException
state_map: Dict[int, dict] = {}
time_criterion_enabled: bool = False


router = APIRouter()
channels: dict[int, set[WebSocket]] = {}

class Cmd(BaseModel):
    boxId: int
    type: str   # START_TIMER, STOP_TIMER, RESUME_TIMER, PROGRESS_UPDATE, REQUEST_ACTIVE_COMPETITOR, SUBMIT_SCORE, INIT_ROUTE, REQUEST_STATE

    # ---- generic optional fields ----
    # for PROGRESS_UPDATE
    delta: float | None = None

    # for SUBMIT_SCORE
    score: float | None = None
    competitor: str | None = None
    registeredTime: float | None = None

    # for INIT_ROUTE
    routeIndex: int | None = None
    holdsCount: int | None = None
    competitors: list[dict] | None = None
    categorie: str | None = None
    timerPreset: str | None = None

    # for SET_TIME_CRITERION
    timeCriterionEnabled: bool | None = None

    # for TIMER_SYNC
    remaining: float | None = None

@router.post("/cmd")
async def cmd(cmd: Cmd):
    print(f"Backend received cmd: {cmd}")
    # Toggle global time criterion without touching per‑box state
    if cmd.type == "SET_TIME_CRITERION":
        global time_criterion_enabled
        time_criterion_enabled = bool(cmd.timeCriterionEnabled)
        await _broadcast_time_criterion()
        return {"status": "ok"}
    # Update server-side state snapshot
    sm = state_map.setdefault(cmd.boxId, {
        "initiated": False,
        "holdsCount": 0,
        "currentClimber": "",
        "started": False,
        "timerState": "idle",
        "holdCount": 0.0,
        "routeIndex": 1,
        "competitors": [],
        "categorie": "",
        "lastRegisteredTime": None,
        "remaining": None,
        "timerPreset": None,
        "timerPresetSec": None,
    })
    if cmd.type == "INIT_ROUTE":
        sm["initiated"] = True
        sm["holdsCount"] = cmd.holdsCount or 0
        sm["routeIndex"] = cmd.routeIndex or 1
        sm["competitors"] = cmd.competitors or []
        sm["currentClimber"] = cmd.competitors[0]["nume"] if cmd.competitors else ""
        sm["started"] = False
        sm["timerState"] = "idle"
        sm["holdCount"] = 0.0
        sm["lastRegisteredTime"] = None
        sm["remaining"] = None
        if cmd.categorie:
            sm["categorie"] = cmd.categorie
        if cmd.timerPreset:
            sm["timerPreset"] = cmd.timerPreset
            sm["timerPresetSec"] = _parse_timer_preset(cmd.timerPreset)
    elif cmd.type == "START_TIMER":
        sm["started"] = True
        sm["timerState"] = "running"
        sm["lastRegisteredTime"] = None
        sm["remaining"] = None
    elif cmd.type == "STOP_TIMER":
        sm["started"] = False
        sm["timerState"] = "paused"
    elif cmd.type == "RESUME_TIMER":
        sm["started"] = True
        sm["timerState"] = "running"
        sm["lastRegisteredTime"] = None
    elif cmd.type == "PROGRESS_UPDATE":
        delta = cmd.delta or 1
        new_count = (int(sm["holdCount"]) + 1) if delta == 1 else round(sm["holdCount"] + delta, 1)
        sm["holdCount"] = new_count
    elif cmd.type == "REGISTER_TIME":
        # doar persistăm dacă avem un timp valid
        if cmd.registeredTime is not None:
            sm["lastRegisteredTime"] = cmd.registeredTime
    elif cmd.type == "TIMER_SYNC":
        sm["remaining"] = cmd.remaining
    elif cmd.type == "SUBMIT_SCORE":
        # Folosește timpul memorat anterior dacă nu e trimis în request
        effective_time = cmd.registeredTime if cmd.registeredTime is not None else sm.get("lastRegisteredTime")
        cmd.registeredTime = effective_time
        sm["started"] = False
        sm["timerState"] = "idle"
        sm["holdCount"] = 0.0
        sm["lastRegisteredTime"] = effective_time
        sm["remaining"] = None
        # marchează competitorul și mută la următorul
        if sm.get("competitors"):
            for comp in sm["competitors"]:
                if comp.get("nume") == cmd.competitor:
                    comp["marked"] = True
                    break
            next_comp = next((c.get("nume") for c in sm["competitors"] if not c.get("marked")), "")
            sm["currentClimber"] = next_comp
    elif cmd.type == "REQUEST_STATE":
        await _send_state_snapshot(cmd.boxId)
        return {"status": "ok"}
    # else: leave previous state for other types
    # Send to all active WebSockets for this box, safely
    sockets = channels.get(cmd.boxId) or set()
    for ws in list(sockets):
        try:
            await ws.send_json(cmd.model_dump())
        except Exception:
            # remove any closed/errored socket
            sockets.discard(ws)
    # după SUBMIT_SCORE, trimite snapshot pentru a propaga currentClimber/holdCount resetate
    if cmd.type == "SUBMIT_SCORE":
        await _send_state_snapshot(cmd.boxId)
    return {"status": "ok"}

@router.websocket("/ws/{box_id}")
async def websocket_endpoint(ws: WebSocket, box_id: int):
    await ws.accept()
    channels.setdefault(box_id, set()).add(ws)
    await _send_state_snapshot(box_id, targets={ws})
    try:
        while True:
            await ws.receive_text()          # ping‑pong if you like
    except Exception:
        pass
    finally:
        channels[box_id].discard(ws)


# Route to get state snapshot for a box
from fastapi import HTTPException

@router.get("/state/{box_id}")
async def get_state(box_id: int):
    """
    Return current contest state for a judge client.
    """
    state = state_map.get(box_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No state found for this box")
    return _build_snapshot(box_id, state)


# helpers
def _build_snapshot(box_id: int, state: dict) -> dict:
    return {
        "type": "STATE_SNAPSHOT",
        "boxId": box_id,
        "initiated": state.get("initiated", False),
        "holdsCount": state.get("holdsCount", 0),
        "routeIndex": state.get("routeIndex", 1),
        "currentClimber": state.get("currentClimber", ""),
        "started": state.get("started", False),
        "timerState": state.get("timerState", "idle"),
        "holdCount": state.get("holdCount", 0.0),
        "competitors": state.get("competitors", []),
        "categorie": state.get("categorie", ""),
        "registeredTime": state.get("lastRegisteredTime"),
        "remaining": state.get("remaining"),
        "timeCriterionEnabled": time_criterion_enabled,
        "timerPreset": state.get("timerPreset"),
        "timerPresetSec": state.get("timerPresetSec"),
    }


async def _send_state_snapshot(box_id: int, targets: set[WebSocket] | None = None):
    state = state_map.get(box_id)
    if state is None:
        return
    payload = _build_snapshot(box_id, state)
    sockets = targets or channels.get(box_id) or set()
    for ws in list(sockets):
        try:
            await ws.send_json(payload)
        except Exception:
            sockets.discard(ws)


def _parse_timer_preset(preset: str | None) -> int | None:
    if not preset:
        return None
    try:
        minutes, seconds = (preset or "").split(":")
        return int(minutes or 0) * 60 + int(seconds or 0)
    except Exception:
        return None


async def _broadcast_time_criterion():
    payload = {
        "type": "TIME_CRITERION",
        "timeCriterionEnabled": time_criterion_enabled,
    }
    for sockets in channels.values():
        for ws in list(sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                sockets.discard(ws)
