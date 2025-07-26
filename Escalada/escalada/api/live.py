# escalada/api/live.py
from fastapi import APIRouter
from pydantic import BaseModel
from starlette.websockets import WebSocket

# state per boxId
from typing import Dict
from fastapi import HTTPException
state_map: Dict[int, dict] = {}


router = APIRouter()
channels: dict[int, set[WebSocket]] = {}

class Cmd(BaseModel):
    boxId: int
    type: str   # START_TIMER, PROGRESS_UPDATE, REQUEST_ACTIVE_COMPETITOR, SUBMIT_SCORE, INIT_ROUTE

    # ---- generic optional fields ----
    # for PROGRESS_UPDATE
    delta: float | None = None

    # for SUBMIT_SCORE
    score: float | None = None
    competitor: str | None = None

    # for INIT_ROUTE
    routeIndex: int | None = None
    holdsCount: int | None = None
    competitors: list[dict] | None = None

@router.post("/cmd")
async def cmd(cmd: Cmd):
    print(f"Backend received cmd: {cmd}")
    # Update server-side state snapshot
    sm = state_map.setdefault(cmd.boxId, {
        "initiated": False,
        "holdsCount": 0,
        "currentClimber": "",
        "started": False,
        "holdCount": 0.0
    })
    if cmd.type == "INIT_ROUTE":
        sm["initiated"] = True
        sm["holdsCount"] = cmd.holdsCount or 0
        sm["currentClimber"] = cmd.competitors[0]["nume"] if cmd.competitors else ""
        sm["started"] = False
        sm["holdCount"] = 0.0
    elif cmd.type == "START_TIMER":
        sm["started"] = True
    elif cmd.type == "PROGRESS_UPDATE":
        delta = cmd.delta or 1
        new_count = (int(sm["holdCount"]) + 1) if delta == 1 else round(sm["holdCount"] + delta, 1)
        sm["holdCount"] = new_count
    elif cmd.type == "SUBMIT_SCORE":
        sm["started"] = False
        sm["holdCount"] = 0.0
    # else: leave previous state for other types
    # Send to all active WebSockets for this box, safely
    sockets = channels.get(cmd.boxId) or set()
    for ws in list(sockets):
        try:
            await ws.send_json(cmd.model_dump())
        except Exception:
            # remove any closed/errored socket
            sockets.discard(ws)
    return {"status": "ok"}

@router.websocket("/ws/{box_id}")
async def websocket_endpoint(ws: WebSocket, box_id: int):
    await ws.accept()
    channels.setdefault(box_id, set()).add(ws)
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
    return state