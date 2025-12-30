# escalada/api/live.py
import asyncio
import json
import logging
# state per boxId
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette.websockets import WebSocket

from escalada.rate_limit import check_rate_limit
# Import validation and rate limiting
from escalada.validation import InputSanitizer, ValidatedCmd
from escalada.db.database import AsyncSessionLocal
from escalada.db import repositories as repos
from escalada.auth.deps import (
    require_box_access,
    require_view_access,
    require_view_box_access,
)
from escalada.auth.service import decode_token

logger = logging.getLogger(__name__)

state_map: Dict[int, dict] = {}
state_locks: Dict[int, asyncio.Lock] = {}  # Lock per boxId
init_lock = asyncio.Lock()  # Protects state_map and state_locks initialization
time_criterion_enabled: bool = False
time_criterion_lock = asyncio.Lock()  # Global time criterion lock


router = APIRouter()
channels: dict[int, set[WebSocket]] = {}
channels_lock = asyncio.Lock()  # Protects concurrent access to channels dict

# Test mode - disable validation for backward compatibility
VALIDATION_ENABLED = True


class Cmd(BaseModel):
    """Legacy Cmd model - use ValidatedCmd for new validation"""

    boxId: int
    type: str  # START_TIMER, STOP_TIMER, RESUME_TIMER, PROGRESS_UPDATE, REQUEST_ACTIVE_COMPETITOR, SUBMIT_SCORE, INIT_ROUTE, REQUEST_STATE

    # ---- generic optional fields ----
    # for PROGRESS_UPDATE
    delta: float | None = None

    # for SUBMIT_SCORE
    score: float | None = None
    competitor: str | None = None
    registeredTime: float | None = None
    competitorIdx: int | None = None

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

    # legacy alias for registeredTime
    time: float | None = None

    # Session token for state bleed prevention
    sessionId: str | None = None

    # Box version for stale command detection (TASK 2.6)
    boxVersion: int | None = None


@router.post("/cmd")
async def cmd(cmd: Cmd, claims=Depends(require_box_access)):
    """
    Handle competition commands with validation and rate limiting

    Validates:
    - Input format and types
    - Box ID range
    - Required fields for each command type
    - Competitor name safety
    - Timer preset format

    Rate Limits:
    - 60 requests/minute per box (global)
    - 10 requests/second per box
    - Per-command-type limits (e.g., PROGRESS_UPDATE: 120/min)
    """

    # ==================== VALIDATION ====================
    # Map legacy "time" field to registeredTime when provided
    if cmd.registeredTime is None and cmd.time is not None:
        cmd.registeredTime = cmd.time

    try:
        if VALIDATION_ENABLED:
            # Build dict with only non-None values
            cmd_data = {k: v for k, v in cmd.model_dump().items() if v is not None}
            if "time" in cmd_data and "registeredTime" not in cmd_data:
                cmd_data["registeredTime"] = cmd_data.pop("time")
            # Validate and sanitize input
            validated_cmd = ValidatedCmd(**cmd_data)
        else:
            # Validation disabled - use cmd as is
            validated_cmd = cmd
    except Exception as e:
        logger.warning(f"Command validation failed for box {cmd.boxId}: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid command: {str(e)}")

    # ==================== RATE LIMITING ====================
    # Skip rate limiting in test mode (when VALIDATION_ENABLED is False)
    if VALIDATION_ENABLED:
        is_allowed, reason = check_rate_limit(cmd.boxId, cmd.type)
        if not is_allowed:
            logger.warning(f"Rate limit exceeded for box {cmd.boxId}: {reason}")
            raise HTTPException(status_code=429, detail=reason)

    # ==================== SANITIZATION ====================
    # Validation already checks for SQL injection/XSS in ValidatedCmd
    # No additional sanitization needed - preserve original input including diacritics

    print(f"Backend received cmd: {cmd}")

    # ==================== ATOMIC STATE INITIALIZATION ====================
    # CRITICAL FIX: Keep lock acquired across entire initialization to prevent race conditions
    # Get or create the box-specific lock under global init_lock protection
    async with init_lock:
        if cmd.boxId not in state_locks:
            state_locks[cmd.boxId] = asyncio.Lock()
        lock = state_locks[cmd.boxId]

    # Toggle global time criterion without touching per‑box state
    if cmd.type == "SET_TIME_CRITERION":
        global time_criterion_enabled
        async with time_criterion_lock:
            time_criterion_enabled = bool(cmd.timeCriterionEnabled)
        await _broadcast_time_criterion()
        return {"status": "ok"}

    # Lock state access for this boxId
    async with lock:
        # Initialize state INSIDE the lock (no window for race condition)
        sm = await _ensure_state(cmd.boxId)

        # Update server-side state snapshot
        sm = state_map[cmd.boxId]

        # ==================== SESSION & VERSION VALIDATION ====================
        # Enforce session/version only when validation is enabled (test-mode bypass)
        if VALIDATION_ENABLED:
            # CRITICAL: Enforce sessionId for all commands except INIT_ROUTE
            if cmd.type != "INIT_ROUTE":
                if not cmd.sessionId:
                    logger.warning(
                        f"Command {cmd.type} for box {cmd.boxId} missing sessionId"
                    )
                    raise HTTPException(
                        status_code=400,
                        detail="sessionId required for all commands except INIT_ROUTE",
                    )

                current_session = sm.get("sessionId")
                if current_session and cmd.sessionId != current_session:
                    logger.warning(
                        f"Stale sessionId for box {cmd.boxId}: "
                        f"received {cmd.sessionId}, expected {current_session}"
                    )
                    return {"status": "ignored", "reason": "stale_session"}

            # TASK 2.6: Validate boxVersion if present (prevents stale commands from old browser tabs)
            if cmd.boxVersion is not None:
                current_version = sm.get("boxVersion", 0)
                if cmd.boxVersion < current_version:
                    logger.warning(
                        f"Stale command for box {cmd.boxId}: "
                        f"version {cmd.boxVersion} < {current_version}"
                    )
                    return {"status": "ignored", "reason": "stale_version"}

        if cmd.type == "INIT_ROUTE":
            # INIT_ROUTE: update competition details and mark as initiated
            # sessionId already generated at state creation
            cmd.sessionId = sm["sessionId"]  # Use existing sessionId
            # TASK 2.6: Increment boxVersion on INIT_ROUTE to invalidate old commands
            sm["boxVersion"] = sm.get("boxVersion", 0) + 1
            sm["initiated"] = True
            sm["holdsCount"] = cmd.holdsCount or 0
            sm["routeIndex"] = cmd.routeIndex or 1
            # Normalize competitors: ensure dicts with safe 'nume' and boolean 'marked'
            normalized_competitors: list[dict] = []
            if cmd.competitors:
                for comp in cmd.competitors:
                    try:
                        if not isinstance(comp, dict):
                            continue
                        name = comp.get("nume")
                        if not isinstance(name, str):
                            continue
                        safe_name = InputSanitizer.sanitize_competitor_name(name)
                        if not safe_name:
                            continue
                        marked_val = comp.get("marked", False)
                        # Coerce to boolean if present
                        marked_bool = (
                            bool(marked_val)
                            if isinstance(marked_val, (bool, int, str))
                            else False
                        )
                        normalized_competitors.append(
                            {"nume": safe_name, "marked": marked_bool}
                        )
                    except Exception:
                        # Silently skip malformed competitor entries
                        continue
            sm["competitors"] = normalized_competitors
            sm["currentClimber"] = (
                normalized_competitors[0]["nume"] if normalized_competitors else ""
            )
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
            new_count = (
                (int(sm["holdCount"]) + 1)
                if delta == 1
                else round(sm["holdCount"] + delta, 1)
            )
            # Clamp lower bound
            if new_count < 0:
                new_count = 0.0
            # Cap to holdsCount only when it's a positive configured maximum
            max_holds = sm.get("holdsCount") or 0
            if isinstance(max_holds, int) and max_holds > 0 and new_count > max_holds:
                new_count = float(max_holds)
            sm["holdCount"] = new_count
        elif cmd.type == "REGISTER_TIME":
            # doar persistăm dacă avem un timp valid
            if cmd.registeredTime is not None:
                sm["lastRegisteredTime"] = cmd.registeredTime
        elif cmd.type == "TIMER_SYNC":
            sm["remaining"] = cmd.remaining
        elif cmd.type == "SUBMIT_SCORE":
            # Folosește timpul memorat anterior dacă nu e trimis în request
            effective_time = (
                cmd.registeredTime
                if cmd.registeredTime is not None
                else sm.get("lastRegisteredTime")
            )
            cmd.registeredTime = effective_time
            sm["started"] = False
            sm["timerState"] = "idle"
            sm["holdCount"] = 0.0
            sm["lastRegisteredTime"] = effective_time
            sm["remaining"] = None
            # marchează competitorul și mută la următorul
            if sm.get("competitors"):
                for comp in sm["competitors"]:
                    # Validate that competitor has required fields
                    if not isinstance(comp, dict):
                        logger.error(f"Invalid competitor object: {comp}")
                        continue
                    if comp.get("nume") == cmd.competitor:
                        comp["marked"] = True
                        break
                next_comp = next(
                    (
                        c.get("nume")
                        for c in sm["competitors"]
                        if isinstance(c, dict) and not c.get("marked")
                    ),
                    "",
                )
                sm["currentClimber"] = next_comp
        elif cmd.type == "REQUEST_STATE":
            await _send_state_snapshot(cmd.boxId)
            return {"status": "ok"}
        elif cmd.type == "RESET_BOX":
            # Reset per-box state and regenerate sessionId to invalidate stale tabs
            import uuid

            sm["initiated"] = False
            sm["currentClimber"] = ""
            sm["started"] = False
            sm["timerState"] = "idle"
            sm["holdCount"] = 0.0
            sm["lastRegisteredTime"] = None
            sm["remaining"] = None
            sm["competitors"] = []
            sm["categorie"] = ""
            sm["timerPreset"] = None
            sm["timerPresetSec"] = None
            # Preserve existing routeIndex/holdsCount; ControlPanel re-sends INIT_ROUTE
            sm["sessionId"] = str(uuid.uuid4())
            # Broadcast fresh snapshot for clients
            await _send_state_snapshot(cmd.boxId)
            return {"status": "ok"}
        # else: leave previous state for other types

        # Persist snapshot + audit log for state-changing commands
        if cmd.type != "REQUEST_STATE":
            persist_result = await _persist_state(cmd.boxId, sm, cmd.type, cmd.model_dump())
            if persist_result == "stale":
                return {"status": "ignored", "reason": "stale_version"}

        # Broadcast command echo to all active WebSockets for this box
        await _broadcast_to_box(cmd.boxId, cmd.model_dump())

        # Send authoritative snapshot for real-time clients
        if cmd.type in {
            "INIT_ROUTE",
            "PROGRESS_UPDATE",
            "START_TIMER",
            "STOP_TIMER",
            "RESUME_TIMER",
            "REGISTER_TIME",
            "SUBMIT_SCORE",
        }:
            await _send_state_snapshot(cmd.boxId)

    return {"status": "ok"}


async def _heartbeat(ws: WebSocket, box_id: int) -> None:
    """Send PING every 30s; close if no PONG for 90s."""
    last_pong = asyncio.get_event_loop().time()
    heartbeat_interval = 30
    heartbeat_timeout = 90

    while True:
        try:
            await asyncio.sleep(heartbeat_interval)
            now = asyncio.get_event_loop().time()

            # Check timeout
            if now - last_pong > heartbeat_timeout:
                logger.warning(f"Heartbeat timeout for box {box_id}, closing")
                try:
                    await ws.close(code=1000)
                except Exception:
                    pass
                break

            # Send PING
            await ws.send_text(
                json.dumps({"type": "PING", "timestamp": now}, ensure_ascii=False)
            )
        except Exception as e:
            logger.debug(f"Heartbeat error for box {box_id}: {e}")
            break


async def _broadcast_to_box(box_id: int, payload: dict) -> None:
    """Safely broadcast JSON payload to all subscribers on a box.
    Removes dead connections automatically.
    """
    # Get snapshot of current subscribers
    async with channels_lock:
        sockets = list(channels.get(box_id) or set())

    dead = []
    for ws in sockets:
        try:
            await ws.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.debug(f"Broadcast error to box {box_id}: {e}")
            dead.append(ws)

    # Clean up dead connections
    if dead:
        async with channels_lock:
            for ws in dead:
                channels.get(box_id, set()).discard(ws)


def _authorize_ws(box_id: int, claims: dict) -> bool:
    """Return True if claims allow subscription to box_id."""
    role = claims.get("role")
    if role == "admin":
        return True
    boxes = set(claims.get("boxes") or [])
    if role == "judge":
        return int(box_id) in boxes
    if role == "viewer":
        # Allow viewers; if boxes are specified, enforce membership
        return not boxes or int(box_id) in boxes
    return False


@router.websocket("/ws/{box_id}")
async def websocket_endpoint(ws: WebSocket, box_id: int):
    token = ws.query_params.get("token")
    if not token:
        await ws.close(code=4401, reason="token_required")
        return

    try:
        claims = decode_token(token)
    except HTTPException as exc:
        await ws.close(code=4401, reason=exc.detail or "invalid_token")
        return

    if not _authorize_ws(box_id, claims):
        await ws.close(code=4403, reason="forbidden_box_or_role")
        return

    await ws.accept()

    # Atomically add to channel
    async with channels_lock:
        channels.setdefault(box_id, set()).add(ws)
        subscriber_count = len(channels[box_id])

    logger.info(f"Client connected to box {box_id}, total: {subscriber_count}")
    await _send_state_snapshot(box_id, targets={ws})

    # Start heartbeat task
    heartbeat_task = asyncio.create_task(_heartbeat(ws, box_id))

    try:
        while True:
            try:
                # Receive with 180s timeout
                data = await asyncio.wait_for(ws.receive_text(), timeout=180)
            except asyncio.TimeoutError:
                logger.warning(f"WebSocket receive timeout for box {box_id}")
                break
            except Exception as e:
                logger.warning(f"WebSocket receive error for box {box_id}: {e}")
                break

            # Handle PONG response
            try:
                msg = json.loads(data) if isinstance(data, str) else data
                if isinstance(msg, dict):
                    msg_type = msg.get("type")

                    # Acknowledge PONG
                    if msg_type == "PONG":
                        continue

                    # NEW: Handle REQUEST_STATE command
                    if msg_type == "REQUEST_STATE":
                        requested_box_id = msg.get("boxId", box_id)
                        logger.info(
                            f"WebSocket REQUEST_STATE for box {requested_box_id}"
                        )
                        await _send_state_snapshot(requested_box_id, targets={ws})
                        continue

            except json.JSONDecodeError:
                logger.debug(f"Invalid JSON from WS box {box_id}")
                continue

    except Exception as e:
        logger.error(f"WebSocket error for box {box_id}: {e}")
    finally:
        # Cancel heartbeat task
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

        # Atomically remove from channel
        async with channels_lock:
            channels.get(box_id, set()).discard(ws)
            remaining = len(channels.get(box_id, set()))

        logger.info(f"Client disconnected from box {box_id}, remaining: {remaining}")

        try:
            await ws.close()
        except Exception:
            pass


# Route to get state snapshot for a box
from fastapi import HTTPException


@router.get("/state/{box_id}")
async def get_state(box_id: int, claims=Depends(require_view_box_access())):
    """
    Return current contest state for a judge client.
    Create a placeholder state with sessionId if box doesn't exist yet.
    """
    # ==================== ATOMIC STATE INITIALIZATION ====================
    # Use global init_lock to prevent race conditions
    async with init_lock:
        if box_id not in state_locks:
            state_locks[box_id] = asyncio.Lock()
    await _ensure_state(box_id)

    state = state_map[box_id]
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
        "sessionId": state.get("sessionId"),  # Include session ID for client validation
    }


async def _send_state_snapshot(box_id: int, targets: set[WebSocket] | None = None):
    # Ensure state exists before sending snapshot
    async with init_lock:
        if box_id not in state_locks:
            state_locks[box_id] = asyncio.Lock()
    await _ensure_state(box_id)

    state = state_map.get(box_id)
    if state is None:
        return
    payload = _build_snapshot(box_id, state)

    # If targets specified (e.g., on new connection), send only to them
    if targets:
        for ws in list(targets):
            try:
                await ws.send_text(json.dumps(payload, ensure_ascii=False))
            except Exception as e:
                logger.debug(f"Failed to send snapshot to target: {e}")
    else:
        # Otherwise broadcast to all subscribers on this box
        await _broadcast_to_box(box_id, payload)


async def _ensure_state(box_id: int) -> dict:
    """Ensure in-memory state exists, hydrated from DB when possible."""
    async with init_lock:
        existing = state_map.get(box_id)
        if existing is not None:
            return existing

    # Try to hydrate from database
    persisted = None
    session_id = None
    box_version = 0
    try:
        async with AsyncSessionLocal() as session:
            repo = repos.BoxRepository(session)
            box = await repo.get_by_id(box_id)
            if box:
                persisted = box.state or {}
                session_id = box.session_id
                box_version = box.box_version or 0
    except Exception as e:
        logger.warning(f"Failed to hydrate box {box_id} from DB: {e}")

    state = _default_state(session_id)
    state.update(persisted or {})
    state["boxVersion"] = box_version
    if not state.get("sessionId"):
        state["sessionId"] = state.get("sessionId") or _default_state()["sessionId"]

    async with init_lock:
        state_map[box_id] = state
    return state


async def _persist_state(box_id: int, state: dict, action: str, payload: dict) -> str:
    """
    Persist snapshot + audit event.
    Returns: "ok", "stale", "missing_box", or "error".
    """
    try:
        async with AsyncSessionLocal() as session:
            box_repo = repos.BoxRepository(session)
            comp_repo = repos.CompetitionRepository(session)
            event_repo = repos.EventRepository(session)

            box = await box_repo.get_by_id(box_id)
            if not box:
                # Create a default competition/box so we don't drop events for new boxes
                comp = await comp_repo.get_by_name("Runtime Default")
                if not comp:
                    comp = await comp_repo.create(name="Runtime Default")
                box = await box_repo.create(
                    competition_id=comp.id,
                    name=f"Box {box_id}",
                    route_index=state.get("routeIndex", 1) or 1,
                    routes_count=state.get("routesCount", 1) or 1,
                    holds_count=state.get("holdsCount", 0) or 0,
                )
                await session.flush()

            current_db_version = box.box_version or 0
            updated_box, success = await box_repo.update_state_with_version(
                box_id=box_id,
                current_version=current_db_version,
                new_state=state,
                new_session_id=state.get("sessionId"),
            )

            if not success:
                # Refresh in-memory state with authoritative DB snapshot
                await box_repo.refresh(box)
                authoritative = box.state or _default_state(box.session_id)
                authoritative["boxVersion"] = box.box_version
                if box.session_id:
                    authoritative["sessionId"] = box.session_id
                async with init_lock:
                    state_map[box_id] = authoritative
                return "stale"

            # Sync in-memory version/session with DB after successful update
            state["boxVersion"] = updated_box.box_version
            if updated_box.session_id:
                state["sessionId"] = updated_box.session_id

            await event_repo.log_event(
                competition_id=updated_box.competition_id,
                action=action,
                payload=payload,
                box_id=updated_box.id,
                session_id=state.get("sessionId"),
                box_version=state.get("boxVersion", 0) or 0,
                action_id=payload.get("actionId") if isinstance(payload, dict) else None,
            )
            await session.commit()
            return "ok"
    except Exception as e:
        logger.warning(f"Failed to persist state for box {box_id}: {e}")
        return "error"


def _default_state(session_id: str | None = None) -> dict:
    import uuid

    return {
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
        "sessionId": session_id or str(uuid.uuid4()),
        "boxVersion": 0,
    }


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
                # Preserve UTF-8 diacritics
                await ws.send_text(json.dumps(payload, ensure_ascii=False))
            except Exception:
                sockets.discard(ws)
