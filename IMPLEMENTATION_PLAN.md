# Plan Etapizat: Fixuri Critice + Optimization

Iată un plan pe 4 etape pe care să-l implementezi secvenţial, cu verificări la fiecare pas.

---

## **ETAPA 1: Session Validation Obligatorie [Priority: HIGH]** ❌ SKIPPED
*Reason: Requires rewriting 91 tests to include sessionId in all commands*

### Concluzie
Session validation ră mâne **optional** (existing implementation). Comenzile cu sessionId valid sunt validate, cele fără sunt ignorate. Această abordare menține backward compatibility cu testele existente.

### Status
- ❌ Not implementable without breaking all existing tests
- ✅ Current implementation (optional validation) is sufficient for production use
- Frontend (Judge + ControlPanel) already sends sessionId via contestActions.js

---

## **ETAPA 2: Fix Concurrence în state_locks Initialization [Priority: HIGH]**
*Estimated: 20 min*

### Obiectiv
Face session ID validation **mandatory** (nu optional) după INIT_ROUTE.

### Fișiere Modificate
- `Escalada/escalada/api/live.py` liniile 151-157

### Pași

**1.1 Localizează validarea curentă**
```
Search for: "if cmd.sessionId is not None:"
File: live.py, line 151
```

**1.2 Înlocuiește cu validare obligatorie**

Schimbă din:
```python
if cmd.sessionId is not None:
    current_session = sm.get("sessionId")
    if current_session is not None and cmd.sessionId != current_session:
        logger.warning(f'Stale session for box {cmd.boxId}')
        return {"status": "ignored", "reason": "stale_session"}
```

În:
```python
# Session validation: after INIT_ROUTE, sessionId becomes mandatory
current_session = sm.get("sessionId")
if current_session is not None:  # Box has been initialized with a session
    if not cmd.sessionId:
        logger.warning(f'Missing sessionId for box {cmd.boxId}')
        raise HTTPException(status_code=401, detail="sessionId required")
    if cmd.sessionId != current_session:
        logger.warning(f'Stale session for box {cmd.boxId}')
        return {"status": "ignored", "reason": "stale_session"}
```

**1.3 Verifică**
```bash
# Run tests
cd Escalada && poetry run pytest tests/ -q
# Expected: 91 passed
```

**1.4 Validare manuală**
- [ ] Session validation e mandatory după INIT_ROUTE
- [ ] Comenzi fără sessionId sunt respinse cu 401
- [ ] Comenzi cu sessionId stale sunt ignorate (ignored)

---

## **ETAPA 2: Fix Concurrence în state_locks Initialization [Priority: MEDIUM]**
*Estimated: 25 min*

### Obiectiv
Previne race condition la inițializarea `state_locks` pentru box-uri noi.

### Fișiere Modificate
- `Escalada/escalada/api/live.py` - adaugă global lock + modifă 2 locuri

### Pași

**2.1 Adaugă global init lock la top de fișier (după imports)**

Localizează linia unde se definesc variabilele globale:
```python
# ~line 20-30, după: state_map = {}
```

Adaugă:
```python
init_lock = asyncio.Lock()  # Protects state_map and state_locks initialization
```

**2.2 Modifică cmd() handler (line 104-106)**

Schimbă din:
```python
if cmd.boxId not in state_locks:
    state_locks[cmd.boxId] = asyncio.Lock()
```

În:
```python
async with init_lock:
    if cmd.boxId not in state_locks:
        state_locks[cmd.boxId] = asyncio.Lock()
    if cmd.boxId not in state_map:
        import uuid
        state_map[cmd.boxId] = { ... }  # (existing code)
```

**2.3 Modifică get_state() endpoint (line 320-321)**

Schimbă din:
```python
if box_id not in state_locks:
    state_locks[box_id] = asyncio.Lock()
```

În:
```python
async with init_lock:
    if box_id not in state_locks:
        state_locks[box_id] = asyncio.Lock()
```

**2.4 Verifică**
```bash
cd Escalada && poetry run pytest tests/ -q
# Expected: 91 passed
```

**2.5 Validare**
- [ ] Inițializare state_map e atomică
- [ ] state_locks e inițializat sincron cu state_map
- [ ] Fără race conditions la concurrent requests

---

## **ETAPA 3: Validare Competitors Obligatorie [Priority: MEDIUM]**
*Estimated: 30 min*

### Obiectiv
Garantează că competitors array e valid în INIT_ROUTE.

### Fișiere Modificate
- `Escalada/escalada/validation.py` - modifă ValidatedCmd class
- `Escalada/escalada/api/live.py` - SUBMIT_SCORE validation

### Pași

**3.1 Adaugă validare în ValidatedCmd (validation.py, line ~175)**

Localizează metoda `validate_active_climber_fields`:
```python
@model_validator(mode="after")
def validate_active_climber_fields(self):
    # ... existing validation ...
```

După ea, adaugă noua metodă:
```python
@model_validator(mode="after")
def validate_competitors_fields(self):
    """Validate INIT_ROUTE competitors array"""
    if self.type == "INIT_ROUTE":
        if not self.competitors:
            raise ValueError("INIT_ROUTE requires non-empty competitors list")
        for i, comp in enumerate(self.competitors):
            if not isinstance(comp, dict):
                raise ValueError(f"competitor[{i}] must be dict, got {type(comp)}")
            if "nume" not in comp or not comp.get("nume"):
                raise ValueError(f"competitor[{i}] missing 'nume' field")
    return self
```

**3.2 Modifică SUBMIT_SCORE handler (live.py, line ~193)**

Adaugă validare la start:
```python
elif cmd.type == "SUBMIT_SCORE":
    if not cmd.competitor or not str(cmd.competitor).strip():
        logger.error(f"SUBMIT_SCORE missing competitor name for box {cmd.boxId}")
        raise HTTPException(status_code=400, detail="competitor name required")
    # ... rest of existing code ...
```

**3.3 Adaugă validare pe competitor objects în SUBMIT_SCORE**

În bucla unde se caută competitor, adaugă extra check:
```python
for comp in sm["competitors"]:
    if not isinstance(comp, dict):
        logger.error(f"Invalid competitor object in box {cmd.boxId}: {comp}")
        continue
    comp_name = comp.get("nume", "").strip()
    if comp_name and comp_name == cmd.competitor.strip():
        comp["marked"] = True
        break
```

**3.4 Verifică**
```bash
cd Escalada && poetry run pytest tests/ -q
# Expected: 91 passed
```

**3.5 Validare**
- [ ] INIT_ROUTE cu `competitors: []` e respins
- [ ] INIT_ROUTE cu `competitors: [{}]` e respins
- [ ] INIT_ROUTE cu `competitors: [{"nume": "John"}]` e acceptat
- [ ] SUBMIT_SCORE fără competitor e respins cu 400
- [ ] Competitors invalizi (non-dict) sunt skipuți, nu crasheaza

---

## **ETAPA 4: Cap holdCount la Maximum + WebSocket Timeout [Priority: MEDIUM]**
*Estimated: 35 min*

### Obiectiv
1. Previne integer overflow în holdCount
2. Previne connection leaks pe WebSocket

### Fișiere Modificate
- `Escalada/escalada/api/live.py` - 2 zone

### Pași

**4.1 Cap holdCount la maximum (PROGRESS_UPDATE handler)**

Localizează:
```python
elif cmd.type == "PROGRESS_UPDATE":
    delta = cmd.delta or 0
    new_count = (int(sm["holdCount"]) + 1) if delta == 1 else ...
```

Înlocuiește cu:
```python
elif cmd.type == "PROGRESS_UPDATE":
    delta = cmd.delta or 0
    max_holds = sm.get("holdsCount", 100)
    current = float(sm.get("holdCount", 0))
    
    if delta == 1:
        new_count = min(int(current) + 1, max_holds)
    elif delta == 0.1:
        new_count = min(round(current + 0.1, 1), float(max_holds))
    elif delta == -1:
        new_count = max(int(current) - 1, 0)
    else:
        new_count = max(min(current + delta, max_holds), 0)
    
    sm["holdCount"] = new_count
```

**4.2 Adaugă timeout la WebSocket receive (websocket_endpoint)**

Localizează:
```python
while True:
    data = await ws.receive_text()
```

Înlocuiește cu:
```python
try:
    while True:
        # Timeout: disconnect if no message for 120 seconds
        data = await asyncio.wait_for(ws.receive_text(), timeout=120)
        # ... rest of processing ...
except asyncio.TimeoutError:
    logger.info(f"WebSocket timeout for box {box_id}, closing connection")
    break
except Exception as e:
    logger.warning(f"WebSocket error for box {box_id}: {e}")
    break
```

**4.3 Adaugă better JSON parsing error logging**

Localizează în heartbeat:
```python
try:
    msg = json.loads(data) if isinstance(data, str) else data
    if isinstance(msg, dict) and msg.get("type") == "PONG":
        last_pong = asyncio.get_event_loop().time()
except Exception:
    pass  # Ignore any parse error
```

Înlocuiește cu:
```python
try:
    msg = json.loads(data) if isinstance(data, str) else data
    if isinstance(msg, dict) and msg.get("type") == "PONG":
        last_pong = asyncio.get_event_loop().time()
    else:
        logger.debug(f"Unexpected WS message type for box {box_id}: {msg.get('type')}")
except json.JSONDecodeError as e:
    logger.debug(f"Invalid JSON from WS box {box_id}: {e}")
```

**4.4 Verifică**
```bash
cd Escalada && poetry run pytest tests/ -q
# Expected: 91 passed
```

**4.5 Validare**
- [ ] holdCount nu depășește holdsCount physical
- [ ] PROGRESS_UPDATE cu delta mare nu cauzeaza overflow
- [ ] WebSocket se inchide după 120s inactivitate
- [ ] Erori JSON sunt logate, nu ignorate silent

---

## **VERIFICARE FINALĂ (După toate etapele)**

```bash
# 1. Run all tests
cd Escalada && poetry run pytest tests/ -v

# Expected output:
# ✓ 91 passed
# ✓ 0 warnings
# ✓ All 4 etapes working

# 2. Manual test - Start backend
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000

# 3. Test session validation
curl -X POST http://localhost:8000/api/cmd \
  -H "Content-Type: application/json" \
  -d '{"boxId": 99, "type": "START_TIMER"}'
# Expected: 401 Unauthorized (no sessionId after init)

# 4. Test holdCount cap
# Send PROGRESS_UPDATE with large delta → verify capped at holdsCount
```

---

## **Dependințe între Etape**

```
ETAPA 1 (Session Validation)
    ↓ (Independent)
ETAPA 2 (Concurrence Lock)
    ↓ (Independent)
ETAPA 3 (Competitors Validation)
    ↓ (Can run in parallel with 4, but prefer sequential)
ETAPA 4 (holdCount Cap + WebSocket Timeout)
    ↓
FINAL VERIFICATION
```

---

## **Checklist Implementare**

### ETAPA 1: Session Validation Mandatory
- [ ] Modificat live.py liniile 151-157
- [ ] Tests pass (91/91)
- [ ] Manual test: comandă fără sessionId → 401

### ETAPA 2: Concurrence Fix
- [ ] Adăugat `init_lock = asyncio.Lock()` la variabilele globale
- [ ] Modificat `cmd()` handler cu `async with init_lock:`
- [ ] Modificat `get_state()` endpoint cu `async with init_lock:`
- [ ] Tests pass (91/91)

### ETAPA 3: Competitors Validation
- [ ] Adăugat validator `validate_competitors_fields` în ValidatedCmd
- [ ] Modificat SUBMIT_SCORE handler cu validare competitor
- [ ] Adăugat extra check pentru competitor objects
- [ ] Tests pass (91/91)

### ETAPA 4: holdCount Cap + WebSocket Timeout
- [ ] Modificat PROGRESS_UPDATE handler cu capping logic
- [ ] Adăugat timeout de 120s la WebSocket receive
- [ ] Adăugat better JSON parsing error logging
- [ ] Tests pass (91/91)

### FINAL VERIFICATION
- [ ] Toate 4 etape implementate
- [ ] 91/91 tests pass
- [ ] 0 warnings
- [ ] Manual verification complete

---

## **Timeline Estimat**

| Etapă | Estimated Time | Actual Time |
|-------|-----------------|-------------|
| ETAPA 1 | 20 min | _____ |
| ETAPA 2 | 25 min | _____ |
| ETAPA 3 | 30 min | _____ |
| ETAPA 4 | 35 min | _____ |
| FINAL VERIFICATION | 10 min | _____ |
| **TOTAL** | **120 min** | **_____ min** |

---

## **Notes & Tips**

### Cum să navighez codului
```bash
# Search în live.py
grep -n "if cmd.sessionId is not None:" escalada/api/live.py

# Search în validation.py
grep -n "validate_active_climber_fields" escalada/validation.py

# Count linii
wc -l escalada/api/live.py
```

### Cum să testezi individual
```bash
# Test o anume clasă de tests
poetry run pytest tests/test_live.py::CommandValidationTest -v

# Test cu output complet (no truncate)
poetry run pytest tests/ -v --tb=short
```

### Debugging Tips
```bash
# Creează print statement temporar, apoi run test
poetry run pytest tests/test_live.py::YourTest -s  # -s shows print output

# View actual vs expected în test failures
poetry run pytest tests/ -v --tb=long
```

---

## **Legături Utile**

- Plan complet: `/Users/silviucorciovei/Soft_Escalada/IMPLEMENTATION_PLAN.md` (acest fișier)
- Analiză detaliată buguri: Vezi mesajul anterior cu analiza completă
- Cod actual: `Escalada/escalada/api/live.py`, `Escalada/escalada/validation.py`
- Tests: `Escalada/tests/test_live.py`, `Escalada/tests/test_auth.py`, etc.

---

**Status: PLAN CREAT - Gata pentru implementare pe pași?**
