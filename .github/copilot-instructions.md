# Escalada - AI Coding Agent Guide

## Project Overview
Real-time climbing competition management system with WebSocket-based synchronization. Backend (FastAPI) handles state management, validation, and rate limiting. Frontend (React + Vite) provides control panel and judge interfaces with live timer/scoring updates.

## Architecture

### Backend (FastAPI + WebSockets)
- **Entry point**: `Escalada/escalada/main.py` - FastAPI app with CORS middleware, request logging
- **Core API**: `Escalada/escalada/api/live.py` - WebSocket broadcasting + command endpoint
- **State model**: Per-box dictionaries (`state_map[boxId]`) with asyncio locks for thread safety
- **Key pattern**: Commands flow through `/api/cmd` → validation → rate limiting → state update → WebSocket broadcast

### Frontend (React 19 + Vite)
- **Control Panel**: `escalada-ui/src/components/ControlPanel.jsx` - Main operator interface managing multiple competition "boxes"
- **Judge Interface**: `escalada-ui/src/components/JudgePage.jsx` - Per-box scoring interface with timer/progress UI
- **State management**: Centralized in `escalada-ui/src/utilis/useAppState.jsx` (React Context) with localStorage persistence
- **Real-time sync**: `useWebSocketWithHeartbeat.js` provides auto-reconnect with PING/PONG heartbeat every 30s

### Communication Flow
1. User action (e.g., START_TIMER) → `contestActions.js` → POST `/api/cmd` with `boxVersion`
2. Backend validates → broadcasts to all WebSocket subscribers on that box channel
3. All clients (ControlPanel + JudgePage) receive update → update local state via `useAppState`
4. BroadcastChannel syncs state across browser tabs (same origin)

## Critical Patterns

### Box Versioning (Stale Command Prevention)
Every box has a `boxVersion` (stored in localStorage `boxVersion-${boxId}`). Commands include `boxVersion`; backend ignores mismatched versions. **Always** read/include boxVersion when sending commands:
```javascript
const getBoxVersion = (boxId) => {
  const parsed = parseInt(localStorage.getItem(`boxVersion-${boxId}`), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};
// Include in commands: { boxId, type: 'START_TIMER', boxVersion: getBoxVersion(boxId) }
```

### Session ID Invalidation (Prevent State Bleed)
**CRITICAL: Prevents ghost Judge tabs from corrupting new box data after deletion**

Each route initialization generates a unique session token stored in `state_map[boxId]["sessionId"]`. Commands without matching session are rejected.

**Backend Flow:**
1. On `INIT_ROUTE`: Generate `sessionId = uuid.uuid4()` and store in state
2. Validate all commands: if `cmd.sessionId != current_session`, reject with reason `stale_session`
3. Include `sessionId` in all state snapshots

**Frontend Flow:**
1. On route initialization: `setSessionId(boxId, st.sessionId)` from server response
2. Include `sessionId: getSessionId(boxId)` in all commands sent by Judge/ControlPanel
3. On box deletion: `localStorage.removeItem(`sessionId-${boxId}`)` to invalidate old tabs

**Why:** Old Judge tab remains open after box deletion → new box at same index receives phantom commands. Session token ensures old tabs' commands are silently rejected.

See `STATE_BLEED_FIXES.md` for detailed implementation.

### Validation & Rate Limiting
- **Input validation**: `escalada/validation.py` uses Pydantic v2 with field/model validators. All commands validated before processing.
- **Rate limits** (enforced in `escalada/rate_limit.py`):
  - 60 req/min per box (global)
  - 10 req/sec per box
  - Custom per-command limits (e.g., PROGRESS_UPDATE: 120/min)
  - Violations trigger 60s block with HTTP 429
- **Toggle validation**: Set `VALIDATION_ENABLED = False` in `live.py` for testing only

### WebSocket Heartbeat Pattern
`useWebSocketWithHeartbeat` sends PONG every 30s, expects PING from backend. Connection closes if no PONG for 60s → automatic exponential backoff reconnect. **Never create raw WebSocket** - use this hook for reliability.

### CORS Configuration
- **Dev defaults**: localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x with any port
- **Override**: Set `ALLOWED_ORIGINS` (comma-separated) or `ALLOWED_ORIGIN_REGEX` env vars
- **Regex**: `main.py` has `allow_origin_regex` for flexible local network access

### Security Layers (OWASP Top 10)
- Path traversal prevention (file path validation)
- XSS/SQL injection blocked in `ValidatedCmd` validators (checks competitor names, etc.)
- JWT tokens for authenticated endpoints (`escalada/auth.py` - HS256, 15min expiry)
- Rate limiting prevents DoS attacks
- Atomic file operations with locks prevent race conditions

## Development Workflows

### Running Locally
```bash
# Backend (runs on port 8000)
cd Escalada
poetry install
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (runs on port 5173, proxies to backend)
cd Escalada/escalada-ui
npm install  # ⚠️ REQUIRED: Install dependencies before first run
npm run dev  # Vite dev server with HMR
```

**Note:** If VS Code shows TypeScript/ESLint errors, ensure `node_modules/` exists by running `npm install` in `escalada-ui/`.

### Testing
```bash
# Backend tests (pytest + Vitest pattern)
cd Escalada
poetry run pytest tests/ -v  # 91 tests covering validation, rate limiting, security

# Frontend tests (Vitest + React Testing Library)
cd Escalada/escalada-ui
npm test  # 28 tests for state management, messaging, control panel flows
npm run test:coverage  # Coverage report
```

### Key Testing Patterns
- **conftest.py**: Stubs FastAPI/Starlette when not installed (allows tests without full deps)
- **Mocks**: `__tests__/setup.js` mocks localStorage, WebSocket, BroadcastChannel for jsdom
- **State tests**: `useAppState.test.jsx` validates Context provider, localStorage persistence, cross-tab sync
- **Integration**: `test_live.py` validates command processing with 48 test cases

## File Conventions

### Python Backend
- **Naming**: Snake_case for files/functions (FastAPI standard)
- **Logging**: Use module-level `logger = logging.getLogger(__name__)` - logs to `escalada.log` + stdout
- **Async**: All WebSocket/state handlers use `async def` with asyncio locks
- **Type hints**: Use modern Python 3.11+ syntax (`int | None` instead of `Optional[int]`)

### React Frontend
- **Components**: PascalCase files (ControlPanel.jsx, JudgePage.jsx)
- **Utilities**: camelCase in `utilis/` directory (note: typo kept for consistency)
- **State updates**: Use functional setState (`prev => ({ ...prev, [key]: value })`) for concurrency safety
- **Refs**: Store latest state in refs when accessed in closures/effects (see `ControlPanel.jsx` lines 105-125)

### Dynamic API Configuration
Never hardcode `localhost:8000`. Use runtime protocol/hostname:
```javascript
const getApiConfig = () => {
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const hostname = window.location.hostname;
  return {
    API_CP: `${protocol}://${hostname}:8000/api/cmd`,
    WS_URL: `${wsProtocol}://${hostname}:8000/ws/box/${boxId}`
  };
};
```

### localStorage Normalization Pattern
When reading from localStorage in storage event listeners, always normalize JSON-encoded values:
```javascript
let normalized = e.newValue || '';
// Check if value is JSON-encoded
if (normalized.startsWith('"') || normalized === 'null' || normalized === 'undefined') {
  try {
    normalized = JSON.parse(normalized) ?? '';
  } catch {}
}
const trimmed = normalized.trim();
// Silent ignore for empty/invalid values
if (!trimmed || trimmed === '""' || trimmed === 'null' || trimmed === 'undefined') {
  return; // Don't send command
}
```
**Why:** Other tabs might write `JSON.stringify("")` which appears non-empty (`'""'` = 2 chars) but backend rejects as empty after validation. This prevents 400 errors on ACTIVE_CLIMBER and similar commands.

## Data Model

### Box Configuration (localStorage `listboxes`)
```javascript
{
  idx: 0,  // Box ID (array index)
  name: "Boulder 1",
  routeIndex: 1,  // Current route (1-based)
  routesCount: 5,  // Total routes in competition
  holdsCount: 25,  // Holds on current route
  timerPreset: "05:00",  // mm:ss format
  categorie: "Seniori",
  concurenti: [{ name: "John Doe", score: 0, time: null, marked: false }]
}
```

### Backend State (`state_map[boxId]`)
```python
{
    "initiated": False,  # Route initialized
    "holdsCount": 0,
    "currentClimber": "",
    "started": False,  # Timer started
    "timerState": "idle",  # "idle" | "running" | "paused"
    "holdCount": 0.0,  # Progress (holds climbed)
    "remaining": None,  # Remaining time (seconds)
    "version": None,  # boxVersion for stale command prevention
}
```

## Common Tasks

### Adding New Command Type
1. Add to `ValidatedCmd.validate_type()` allowed set in `validation.py`
2. Add model validator if command needs specific fields (see `validate_init_route_fields`)
3. Handle in `live.py` cmd() function (update state, broadcast)
4. Add corresponding action in `contestActions.js`
5. Write tests in `test_live.py` (valid + invalid cases)

### Modifying Rate Limits
Edit `rate_limit.py` RateLimiter class or set custom per-command limits:
```python
limiter = RateLimiter(max_per_minute=300, max_per_second=20)
limiter.set_command_limit('PROGRESS_UPDATE', 120)  # 120/min for progress updates
```

### Debugging WebSocket Issues
- Check browser console for "WebSocket connected" / "Heartbeat timeout"
- Backend logs show "Client connected to box X" / "Client disconnected"
- Verify boxVersion matches between localStorage and commands (console.log in `contestActions.js`)
- Use `VALIDATION_ENABLED = False` to bypass validation temporarily

## Recent Improvements (Dec 2025)
- **Security**: Comprehensive OWASP Top 10 coverage with 11 vulnerability fixes
- **Reliability**: WebSocket heartbeat + auto-reconnect (99.9% uptime)
- **State Management**: Consolidated into AppStateProvider (eliminated fragmentation)
- **Testing**: 91 backend + 28 frontend tests with full coverage of validation/rate limiting
- **Bug Fixes**: Next Route button guard for single-route boxes, CORS regex configurability
- **State Bleed Prevention** (Dec 24): Session ID invalidation blocks phantom commands from old Judge tabs

## References
- **API Documentation**: See `FINAL_REPORT.md` for full feature list and test coverage
- **Bug History**: `BUGFIX_NEXT_ROUTE_AND_CORS.md`, `BUGFIX_SUMMARY.md` for resolved issues
- **Test Examples**: `tests/test_live.py` (backend), `escalada-ui/src/__tests__/` (frontend)
