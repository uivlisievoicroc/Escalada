# Ghid complet pentru aplicatia Escalada - Suport de curs pentru programatori incepatori

## Introducere: Ce este Escalada?

**Escalada** este o aplicație de management al competițiilor de escaladă în timp real. Imaginează-ți un sală de escaladă cu mai multe "arii de concurs" (numite **boxes**). Fiecare box are:
- Un **organizator** (ControlPanel) care inițiază traseele și vede starea generală
- **Arbitri** (Judges) pe fiecare box care votează dacă alpinistul a reușit o dificultate
- O **afișare mare** (ContestPage) care arată clasamentele live

**Scopul acestui ghid**: Să înțelegi cum funcționează internul aplicației, cum se comunică componentele, și cum poți contribui cu cod nou.

## 1. Arhitectura - "Cum vorbesc piesele între ele?"

### Client-Server Model (Conceptul fundamental)

Web-ul modern funcționează după modelul **Client-Server**:
- **Client** = browserul tău (ControlPanel, JudgePage, ContestPage - rulea pe 127.0.0.1:5173)
- **Server** = calculatorul care gestionează starea (Backend FastAPI - rulează pe 127.0.0.1:8000)
- **Comunicare**: Client cere date/trimite comenzi; Server răspunde

### Escalada: O arhitectură cu 3 niveluri

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React 19)                      │
│  ControlPanel  |  JudgePage  |  ContestPage               │
│   (Organizator)   (Arbitru)     (Afișaj Live)             │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP POST  │ WebSocket (real-time)
               ↓            ↓
┌──────────────────────────────────────────────────────────────┐
│               BACKEND (FastAPI + Python)                     │
│  /api/cmd           /api/ws/{boxId}      /api/state/{id}    │
│ (Comenzi)    (Broadcast real-time)  (Snapshot stare)      │
└──────────────┬──────────────────────────────────────────────┘
               │
               ↓
        Fișiere + localStorage
```

### Ce se întâmplă în timp real?

1. **Organizator** (pe ControlPanel) apasă "START TIMER" → trimite `POST /api/cmd` cu comanda
2. **Backend** primește comanda, o validează, și **actualizează starea internă** (serverul memora că timer-ul e pornit)
3. **Backend-ul anunță toți clienții** (prin WebSocket) că s-a schimbat ceva → `STATE_SNAPSHOT`
4. **Toți arbitrii** (pe JudgePage, în tab-uri diferite sau chiar pe dispozitive diferite) primesc imediat mesajul
5. **Afișajul live** (ContestPage) se actualizează și arată timer-ul pornit

### Componente principale:

- **Backend (FastAPI)**: 
  - `escalada/main.py` - inițializează app-ul, CORS, logging
  - `escalada/api/live.py` - toate comenzile de competiție și WebSocket
  - `escalada/validation.py` - verifică dacă datele primite sunt corecte
  - `escalada/rate_limit.py` - limitează de câte ori poți trimite comenzi (anti-spam)

- **Frontend (React)**:
  - `ControlPanel.tsx` - interfață pentru organizator (create boxes, start timer, see results)
  - `JudgePage.tsx` - interfață pentru arbitri (mark progress, submit scores)
  - `ContestPage.tsx` - afișaj mare pe ecranul din sală (live rankings, timer)
  - `useAppState.jsx` - "creierul" frontend-ului care memora toată starea (echivalentul localStorage + stare React)

- **Comunicare real-time**:
  - **HTTP POST** (`/api/cmd`) - pentru comenzi importante (START_TIMER, SUBMIT_SCORE)
  - **WebSocket** (`/api/ws/{boxId}`) - pentru broadcast-ul imediat al schimbărilor la toți clienții conectați la acel box

## 2. Structura de directoare și ce găsești în fiecare loc

```
Soft_Escalada/
├── Escalada/                          # Root backend + frontend
│   ├── escalada/                      # Backend (Python + FastAPI)
│   │   ├── main.py                    # Pornirea app-ului FastAPI
│   │   ├── validation.py              # Verificare date (Pydantic validators)
│   │   ├── rate_limit.py              # Limitare cereri (max 60/minut per box)
│   │   ├── auth.py                    # JWT tokens (securitate)
│   │   ├── api/
│   │   │   ├── live.py                # CORE: Comenzi competiție + WebSocket
│   │   │   ├── podium.py              # Clasamente
│   │   │   └── save_ranking.py        # Export CSV/JSON
│   │   └── routers/upload.py          # Upload fișiere (Excel cu competitori)
│   │
│   ├── escalada-ui/                   # Frontend (React + Vite)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ControlPanel.tsx   # Interfață organizator
│   │   │   │   ├── JudgePage.tsx      # Interfață arbitru (per box)
│   │   │   │   └── ContestPage.tsx    # Afișaj live (pe proiector)
│   │   │   ├── utilis/                # Funcții helper
│   │   │   │   ├── useAppState.jsx    # State management global (Context API)
│   │   │   │   ├── useWebSocketWithHeartbeat.js  # WebSocket cu auto-reconnect
│   │   │   │   ├── contestActions.js  # Logică pentru comenzi
│   │   │   │   └── useLocalStorage.js # Wrapper pentru localStorage
│   │   │   └── __tests__/             # Teste (Vitest + React Testing Library)
│   │   ├── package.json               # Dependențe npm (React, Vite, Vitest, Playwright)
│   │   └── vite.config.ts             # Configurare Vite (development server)
│   │
│   ├── tests/                         # Teste backend (pytest)
│   │   ├── test_live.py               # 48 teste pentru comenzi competiție
│   │   ├── test_auth.py               # Teste JWT
│   │   ├── test_podium.py             # Teste clasamente
│   │   └── test_save_ranking.py       # Teste export
│   │
│   └── pyproject.toml                 # Dependențe Python (FastAPI, pytest, etc)
│
├── .github/
│   └── workflows/                     # GitHub Actions (CI/CD)
│       ├── ci.yml                     # Rulează teste pe fiecare push
│       ├── deploy.yml                 # Deploy automat pe production
│       └── nightly.yml                # Teste extended pe noapte
│
└── README.md                          # Documentație proiect
```

### De memorat:
- **Backend fișiere = `.py`** (Python) - rulează pe server
- **Frontend fișiere = `.jsx`, `.tsx`, `.js`** (JavaScript/React) - rulează în browser
- **Teste = `test_*.py` (backend) și `*.test.jsx` (frontend)** - validează codul
- **Config fișiere = `*.json`, `*.toml`, `*.yml`** - setări pentru tools

## 3. Setup și rulare COMPLETĂ pentru prima dată

### Cerințe: Ce trebuie instalat pe calculatorul tău

- **Git** - pentru versionare cod (deja ai, vezi că ai `.git/`)
- **Python 3.11+** - limbajul backend-ului
- **Node.js 20+** - runtime pentru JavaScript/React
- **Poetry** - manager de dependențe Python
- **npm** - manager de dependențe JavaScript

**Verifică dacă ai instalate:**

```bash
python --version       # Trebuie să fie 3.11 sau mai nou
node --version        # Trebuie Node 20+
npm --version
poetry --version
```

### Setup COMPLET (o singură dată):

```bash
# 1. Clone repo (dacă nu l-ai deja)
git clone https://github.com/username/Soft_Escalada.git
cd Soft_Escalada

# 2. Backend setup
cd Escalada
poetry install         # Descarcă toate librăriile Python din pyproject.toml
                       # Aceasta crează un "virtual environment" izolat

# 3. Frontend setup
cd escalada-ui
npm install            # Descarcă React, Vite, Vitest din package.json
cd ../..               # Înapoi în root
```

### Rulare în dezvoltare (de fiecare dată când vrei să lucrezi):

**Terminal 1 - Backend:**
```bash
cd Escalada
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000
```

⏸️ Expect să vezi:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete
```

**Terminal 2 - Frontend:**
```bash
cd Escalada/escalada-ui
npm run dev
```

⏸️ Expect să vezi:
```
VITE v6.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  press h to show help
```

### Acum poți accesa aplicația:

- **ControlPanel** (Organizator): http://localhost:5173/
- **JudgePage** (Arbitru): http://localhost:5173/judge
- **ContestPage** (Afișaj): http://localhost:5173/contest
- **Backend Docs**: http://localhost:8000/docs (Swagger - API documentation)

### Verifică că merge:

1. Deschide ControlPanel → trebuie să vezi o interfață cu buton "Create Box"
2. Apasă "Create Box" → apare o nouă "arie de concurs"
3. Apasă butonul "Initialize Route" → apar campuri pentru competitori
4. În alt tab, deschide http://localhost:5173/judge → trebuie să vezi aceeași arie
5. Dacă modifici ceva în ControlPanel, trebuie să se actualizeze imediat în JudgePage → **asta e WebSocket-ul în acțiune!**

## 4. Fluxul competiției - Pas cu pas (cum decurge o competiție)

### Imagina scenul:

Ești în sală de escaladă cu 3 arii de concurs (3 boxes). Vrei să organizezi o competiție cu 2 trasee (routes) pe fiecare arie.

### FAZA 1: Organizatorul crează infrastructure

```
ControlPanel (organizator) apasă "Create Box 1"
    ↓
Backend creează un "box" cu ID=0, stare inițială (not initialized)
    ↓
Frontend salvează în localStorage key "listboxes"
    ↓
Se afișează box-ul în ControlPanel cu buton "Initialize Route"
```

**Ce se salvează în localStorage:**
```javascript
localStorage.setItem('listboxes', JSON.stringify([
  {
    idx: 0,                 // ID-ul box-ului
    name: "Boulder 1",      // Nume custom
    routeIndex: 1,          // Traseul curent (1 = al doilea traseu)
    routesCount: 2,         // Total 2 trasee
    holdsCount: 25,         // 25 dificultăți pe traseu
    timerPreset: "05:00",   // Timp per tentativă
    categorie: "Seniori",   // Categoria competiției
    concurenti: []          // Vor fi adăugați mai tarziu
  }
]))
```

---

### FAZA 2: Organizatorul inițiază un traseu

```
ControlPanel apasă "Initialize Route" pentru Box 1
    ↓
Trimite: POST /api/cmd { 
  boxId: 0, 
  type: "INIT_ROUTE", 
  holdsCount: 25, 
  competitors: ["Alice", "Bob", "Charlie"]
}
    ↓
Backend validează:
  - Are boxId? ✓
  - Are competitors? ✓
  - HoldsCount e număr? ✓
    ↓
Backend actualizează state_map[0] = {
  initiated: true,
  holdsCount: 25,
  currentClimber: "Alice",
  competitors: [...],
  started: false,
  sessionId: "uuid-random-123"  // IMPORTANT: pentru securitate
}
    ↓
Backend anunță toți clienții WebSocket pe canalul "box/0":
  MESSAGE: {
    type: "STATE_SNAPSHOT",
    boxId: 0,
    state: {...},
    sessionId: "uuid-random-123"
  }
    ↓
Toți clienții (JudgePage, ContestPage) conectați la Box 1 primesc snapshot-ul
Frontend salvează sessionId: localStorage.setItem("sessionId-0", "uuid-random-123")
```

---

### FAZA 3: Arbitrul veghează competiția

```
JudgePage (arbitru) veghea pe Box 1
    ↓
Vede 3 competitori: Alice, Bob, Charlie
    ↓
Alice încearcă să escaladeze. Arbitrul apasă "+1" pentru a marca dificultatea
    ↓
Trimite: POST /api/cmd {
  boxId: 0,
  type: "PROGRESS_UPDATE",
  increment: 1,
  sessionId: "uuid-random-123"  // IMPORTANT: validare
}
    ↓
Backend validează:
  - sessionId-ul e corect pentru Box 0? ✓
  - increment e între 0 și 0.5? ✓
  - Pe ce competitor? (currentClimber) ✓
    ↓
Backend actualizează: state_map[0].competitors[0].score += 1
    ↓
Broadcast pe WebSocket: PROGRESS_UPDATE { boxId: 0, competitor: "Alice", score: 1 }
    ↓
TOȚI clienții se actualizează imediat (ControlPanel, alte JudgePage-uri, ContestPage)
```

---

### FAZA 4: Finalizare și export

```
După competiție, organizatorul apasă "Save Results"
    ↓
Trimite: POST /api/save_ranking { categories, results }
    ↓
Backend creează CSV cu clasament
    ↓
CSV se descarcă: escalada_results.csv
```

---

### Cheia: **SessionID pentru securitate**

De ce e important `sessionId`?

Imagine că:
1. Ai deschis JudgePage pentru Box 0 și e conectat la WebSocket
2. Ștergi Box 0
3. Crezi Box 0 din nou
4. **PROBLEMA**: Vechia fereastră JudgePage e încă deschisă și încă conectată!

Dacă nu ar fi sessionId, comanda veche de pe JudgePage ar reface Box 0 cu datele vechi!

**Cu sessionId**:
- Cand ștergi Box 0, sessionId-ul vechi devine invalid
- Cand crezi Box 0 din nou, primești sessionId DIFERIT
- Comanda veche din JudgePage nu merge → Backend o respinge cu "stale_session"
- **Protejare garantată!**

## 5. Endpoint-uri și WebSocket - "Cum vorbesc piesele"

### HTTP Endpoints (Request-Response model)

Client cere ceva, serverul răspunde o dată.

#### `POST /api/cmd` - Transmitere comenzi

**De ce POST și nu GET?**
- GET = citire (nu modifică nimic)
- POST = scriere (trimite date care modifică serverul)

**Exemplu: Organizator pornește timer-ul**

```javascript
// Frontend (ControlPanel.tsx)
const startTimer = async (boxId) => {
  const response = await fetch('http://localhost:8000/api/cmd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boxId: 0,
      type: 'START_TIMER',
      sessionId: localStorage.getItem('sessionId-0'),
      boxVersion: localStorage.getItem('boxVersion-0')
    })
  });
  
  const data = await response.json();
  // { status: 'ok', message: 'Timer started' } sau error
};
```

```python
# Backend (escalada/api/live.py)
@app.post('/api/cmd')
async def cmd(request: Request):
    body = await request.json()  # Citesc: { boxId, type, sessionId }
    
    # Validez cu Pydantic
    cmd = ValidatedCmd(**body)   # Aruncă error dacă invalid
    
    # Gasesc starea boxului
    state = state_map.get(cmd.boxId)
    
    # Verific sessionId
    if cmd.sessionId != state.get('sessionId'):
        return { 'error': 'stale_session' }  # Reject!
    
    # Aplic logica
    if cmd.type == 'START_TIMER':
        state['started'] = True
        state['timer'] = 0
    
    # Broadcast la toți clienții WebSocket
    await broadcast_to_box(cmd.boxId, {
        'type': 'STATE_SNAPSHOT',
        'state': state
    })
    
    return { 'status': 'ok' }
```

**Tipuri de comenzi valide:**

| Tip | Ce face | Exemplu |
|-----|---------|---------|
| `INIT_ROUTE` | Pornește un traseu nou | Organizator apasă "Start Route" |
| `START_TIMER` | Pornește cronometrul | Timer pentru o tentativă |
| `STOP_TIMER` | Oprește cronometrul | Alpinistul a terminat |
| `PROGRESS_UPDATE` | Crește scorul (+1 sau +0.5) | Arbitru apasă "+1 Hold" |
| `SUBMIT_SCORE` | Finalizează scorul alpinistului | Schimbă al următorul competitor |
| `REQUEST_STATE` | Cere snapshot actual | JudgePage se reconectează |

---

#### `GET /api/state/{boxId}` - Cere stare

Cand JudgePage se reconecteaza (ex. refresh), cere starea actuala fara sa asteapte WebSocket.

```javascript
// Frontend
const getBoxState = async (boxId) => {
  const response = await fetch(`http://localhost:8000/api/state/${boxId}`);
  const state = await response.json();
  // { initiated: true, holdsCount: 25, competitors: [...], sessionId: "..." }
  setBoxState(state);
};
```

---

#### `POST /api/save_ranking` - Export rezultate

```javascript
// Frontend (ControlPanel.tsx)
const saveResults = async () => {
  const response = await fetch('http://localhost:8000/api/save_ranking', {
    method: 'POST',
    body: JSON.stringify({
      categories: ['Seniori', 'Juniori'],
      results: [...]
    })
  });
  
  // File download: escalada_results.csv
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'results.csv';
  a.click();
};
```

---

### WebSocket - Real-time broadcast

**HTTP e *lent* pentru real-time** (client trebuie să întrebe repetat). **WebSocket e instant** (serverul anunță toți).

```javascript
// Frontend
const ws = new WebSocket('ws://localhost:8000/api/ws/box/0');

ws.onopen = () => {
  console.log('Connected to Box 0');
  // Serverul trimite imediat STATE_SNAPSHOT
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'STATE_SNAPSHOT') {
    // Actualizez componenta cu noua stare
    setBoxState(message.state);
  }
  
  if (message.type === 'PROGRESS_UPDATE') {
    // Un competitor a marcat o dificultate
    updateCompetitorScore(message.competitor, message.score);
  }
};

ws.onclose = () => {
  console.log('Disconnected - trying to reconnect...');
  setTimeout(() => {
    // Reconexiune automată după 3 secunde
  }, 3000);
};
```

```python
# Backend
from fastapi import WebSocketException

@app.websocket('/api/ws/box/{box_id}')
async def websocket_endpoint(websocket: WebSocket, box_id: int):
    await websocket.accept()  # Acceptă conexiunea
    
    # Trimite snapshot actual
    snapshot = state_map.get(box_id, {})
    await websocket.send_json({
        'type': 'STATE_SNAPSHOT',
        'state': snapshot
    })
    
    # Adaugă în lista de conectare pentru broadcast
    box_channels[box_id].add(websocket)
    
    try:
        # Ascultă pentru ping-uri (heartbeat)
        while True:
            message = await websocket.receive_json()
            if message.get('type') == 'PONG':
                # Acceptă heartbeat, client e viu
                pass
    except Exception as e:
        # Deconectare
        box_channels[box_id].remove(websocket)
        print(f'Client disconnected: {e}')
```

**Heartbeat pattern** (Keep-alive):

Conexiunea WebSocket moare dacă e inactivă. Soluție: **ping-pong**

```
[Client]                [Server]
   |                       |
   |  ←--- PING (30s) ---|  |
   |                       |
   |  |--- PONG -------→   |
   |                       |
```

Escalada trimite PING la fiecare 30s. Dacă clientul nu răspunde în 60s, se deconectează.

## 6. Validare și Sesiuni - Cum Backend-ul "protejeaza" integritatea

### Validare (Pydantic) - "Datele mele sunt corecte?"

**Problema**: Oricine poate trimite orice pe `POST /api/cmd`. Ce dacă trimite:

```javascript
{ boxId: 'numaimi', type: 'INVALID_TYPE', holdsCount: -999 }
```

Backend-ul trebuie să respingă asta instant. Soluție: **Validare**

```python
# escalada/validation.py
from pydantic import BaseModel, field_validator, model_validator

class ValidatedCmd(BaseModel):
    boxId: int  # Trebuie să fie număr întreg
    type: str
    sessionId: str | None = None
    
    @field_validator('boxId')
    @classmethod
    def validate_boxId(cls, v):
        if v < 0:
            raise ValueError('boxId must be non-negative')
        return v
    
    @field_validator('type')
    @classmethod
    def validate_type(cls, v):
        ALLOWED = ['INIT_ROUTE', 'START_TIMER', 'PROGRESS_UPDATE', 'SUBMIT_SCORE']
        if v not in ALLOWED:
            raise ValueError(f'Invalid type: {v}. Must be one of {ALLOWED}')
        return v
    
    @model_validator(mode='after')
    def validate_init_route_fields(self):
        """Validare specifică pentru INIT_ROUTE"""
        if self.type == 'INIT_ROUTE':
            if not hasattr(self, 'holdsCount') or self.holdsCount < 1:
                raise ValueError('INIT_ROUTE needs holdsCount >= 1')
        return self
```

**Cum se folosește:**

```python
@app.post('/api/cmd')
async def cmd(request: Request):
    try:
        cmd = ValidatedCmd(**await request.json())
        # Dacă am ajuns aici, datele sunt 100% valide
    except ValueError as e:
        return { 'error': str(e) }, 400  # Bad request
```

### SessionID - "Ești sigur că ești la Box-ul corect?"

Securitate: Doar clientul care a inițializat Box 0 pe WebSocket trebuie să-l poată modifica.

```
[Organizator]                           [Backend]
   |                                       |
   | POST /api/cmd { INIT_ROUTE } ----→   |
   |                                       |
   | ←---- { sessionId: "abc123" } --|    |
   | localStorage['sessionId-0'] = "abc123"
   |
   | POST /api/cmd {                      |
   |   PROGRESS_UPDATE,                   |
   |   sessionId: "abc123"  --------→    |
   | }                                     |
   |                                       |
   |        ✓ Match! → Accept
```

**Dar dacă o fereastră veche încearcă:**

```
[Vechia JudgePage]                     [Backend]
   |                                       |
   | POST /api/cmd {                      |
   |   PROGRESS_UPDATE,                   |
   |   sessionId: "abc123"  --------→    |
   | }                                     |
   |                                       |
   |        ✗ Box 0 a fost șters!
   |        Nou sessionId = "xyz789"
   |        "abc123" != "xyz789" → Reject!
   |
   | ←---- { error: "stale_session" }
```

### Rate Limiting - "Nu spamui comenzile!"

Fără limită, cineva ar putea trimite 1000 cereri pe secundă și face server-ul lent.

```python
# escalada/rate_limit.py
class RateLimiter:
    def __init__(self, max_per_minute=300, max_per_second=20):
        self.max_per_minute = 300  # 5/sec average
        self.max_per_second = 20   # Burst max
        
        # Per-command overrides
        self.limits = {
            'PROGRESS_UPDATE': 120,  # Puteți da +1 max 120x pe minut
            'START_TIMER': 10,       # Pornire timer max 10x pe minut
        }
    
    async def check_limit(self, box_id, command_type):
        if blocked:
            raise HTTPException(429, "Too many requests")
        
        self.record_request(box_id, command_type)

# Folosire
@app.post('/api/cmd')
async def cmd(cmd: ValidatedCmd):
    await rate_limiter.check_limit(cmd.boxId, cmd.type)
    # Dacă nu e blocat, continuă...
```

**Exemplu**: Dacă apesi de 120+ ori pe minut "+1 Hold", comanda e blocată pentru 60 de secunde.

## 7. localStorage și Sincronizare - "Cum îți amintesc cine ești?"

### localStorage - Memorie browserului

Cand inchizi tab-ul browserului, datele se pierd. **localStorage** le salvează pe disc (chiar dacă inchizi browser-ul).

**Chei folosite în Escalada:**

```javascript
// Sesiuni per box
localStorage.setItem('sessionId-0', 'uuid-random-123');
localStorage.getItem('sessionId-0');  // 'uuid-random-123'

// Versiune box (anti-stale-updates)
localStorage.setItem('boxVersion-0', '1');
// Daca serverul zice ca versiunea e 2, clientul e "out of sync"

// Cache timer
localStorage.setItem('timer-0', '120');  // 2 minute

// Toate boxurile
localStorage.setItem('listboxes', JSON.stringify([
  { idx: 0, name: 'Boulder 1', ... },
  { idx: 1, name: 'Boulder 2', ... }
]));

// Rezultate cache pe categoria
localStorage.setItem('category-Seniori-results', JSON.stringify([
  { name: 'Alice', score: 25, time: 120 },
  { name: 'Bob', score: 24, time: 115 }
]));
```

### BroadcastChannel - Sincronizare între tab-uri

Deschizi 2 tab-uri cu ControlPanel. Modifici Box-ul în tabul 1. Tabul 2 trebuie să se actualizeze imediat.

```javascript
// Tab 1
const channel = new BroadcastChannel('escalada-sync');
channel.postMessage({
  type: 'BOX_UPDATED',
  boxId: 0,
  newState: { ... }
});

// Tab 2 (pe același domeniu)
const channel = new BroadcastChannel('escalada-sync');
channel.onmessage = (event) => {
  if (event.data.type === 'BOX_UPDATED') {
    // Actualizez UI-ul cu noua stare
    setBoxState(event.data.newState);
  }
};
```

### Storage Event Listener - Ascultă modificări localStorage

Cand un script din alt tab modifica `localStorage`, toți ceilalți tab-uri primesc notificare.

```javascript
// Tab 1 - modifică localStorage
localStorage.setItem('listboxes', JSON.stringify([...]));

// Tab 2 - ascultă
window.addEventListener('storage', (event) => {
  if (event.key === 'listboxes') {
    const newBoxes = JSON.parse(event.newValue);
    // Actualizez lista de box-uri
    setListBoxes(newBoxes);
  }
});
```

**Caz de uz**: Organizatorul crează box-uri în tabul 1. Interfața Judge din tabul 2 vede automat noul box.

## 8. Testare - "Sigur merge?"

### Backend - Teste cu pytest

**Ce testează**: Rutele API, WebSocket, validare, concurență.

```bash
cd Escalada
poetry run pytest tests/ -v
```

**Exemplu test:**

```python
# tests/test_live.py
def test_init_route_basic():
    """Verific că INIT_ROUTE marchează box ca initialized"""
    
    # Setup
    boxId = 0
    cmd = {
        'boxId': boxId,
        'type': 'INIT_ROUTE',
        'holdsCount': 25,
        'competitors': ['Alice', 'Bob']
    }
    
    # Execut
    response = client.post('/api/cmd', json=cmd)
    
    # Verific
    assert response.status_code == 200
    assert state_map[boxId]['initiated'] == True
    assert len(state_map[boxId]['competitors']) == 2
```

**Tipuri de teste:**

| Tip | Ce testează | Exemplu |
|-----|------------|---------|
| Unit | Funcții individuale | `validate_timer_preset()` |
| Integration | Rute API + stare | `POST /api/cmd → state_map updated` |
| Concurrency | Operații simultane | 2 box-uri în paralel |
| Security | Validare + sessionId | Reject fără sessionId |

---

### Frontend - Teste cu Vitest

**Ce testează**: Componente React, state management, WebSocket mock.

```bash
cd Escalada/escalada-ui
npm test -- --run
```

**Exemplu test React:**

```javascript
// src/__tests__/ControlPanel.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import ControlPanel from '../components/ControlPanel';

test('ControlPanel renders Create Box button', () => {
  // Setup
  render(<ControlPanel />);
  
  // Caut button
  const button = screen.getByText('Create Box');
  
  // Verific că e vizibil
  expect(button).toBeInTheDocument();
});

test('clicking Create Box adds a new box', () => {
  render(<ControlPanel />);
  
  const button = screen.getByText('Create Box');
  fireEvent.click(button);
  
  // Verific că componentul a rendat un nou box
  expect(screen.getByText(/Boulder/i)).toBeInTheDocument();
});
```

---

### E2E (End-to-End) - Teste cu Playwright

**Ce testează**: Flux complet (Organizator → Judge → Contest).

```bash
cd Escalada/escalada-ui
npm run test:e2e
```

**Exemplu E2E:**

```javascript
// e2e/full-competition.spec.js
import { test, expect } from '@playwright/test';

test('full competition flow', async ({ browser }) => {
  // 3 browser contexts = 3 dispozitive diferite
  const ctxOrganizer = await browser.newContext();
  const ctxJudge = await browser.newContext();
  const ctxDisplay = await browser.newContext();
  
  // Organizator creeaza Box
  const pageOrg = await ctxOrganizer.newPage();
  await pageOrg.goto('http://localhost:5173');
  await pageOrg.click('button:has-text("Create Box")');
  
  // Judge se conectează
  const pageJudge = await ctxJudge.newPage();
  await pageJudge.goto('http://localhost:5173/judge');
  const boxes = await pageJudge.locator('[data-test=box]');
  expect(await boxes.count()).toBe(1);
  
  // Organizator porneste timer
  await pageOrg.click('button:has-text("Start Timer")');
  
  // Verific că timer apare și pe Judge
  const timerJudge = pageJudge.locator('[data-test=timer]');
  await expect(timerJudge).toContainText('4:59');  // Aproape 5 minute
  
  // Cleanup
  await ctxOrganizer.close();
  await ctxJudge.close();
  await ctxDisplay.close();
});
```

---

### Cum să rulezi teste local

```bash
# Toti testele
npm test -- --run

# Cu coverage
npm run test:coverage

# UI interactiv (vezi ce testeaza)
npm test                     # CTRL+C pentru a iesi

# Doar E2E
npm run test:e2e

# E2E cu UI
npm run test:e2e:ui
```

---

### CI/CD - Teste automate pe GitHub

Cand faci `git push`, GitHub rulează automat:

```
✓ Backend tests (93 teste)
✓ Frontend tests (186 teste)
✓ E2E tests (61 teste)
✓ Formatting (black, prettier)
✓ Linting (ESLint, pylint)
```

Dacă vreun test cade, commit-ul e marcat cu ❌ și nu se poate merge în `main`.

## 9. Sfaturi de debugging și troubleshooting

### Problema: Judge nu se actualizează la Box

**Simptome**: Organizatorul apasă "+1 Hold", dar scorul nu se actualizează la Judge.

**Cauzele posibile** și cum să diagnostichezi:

1. **WebSocket nu e conectat**
   ```javascript
   // În consola browserului (F12 → Console)
   console.log('WebSocket state:', ws.readyState);
   // 0 = connecting, 1 = open, 2 = closing, 3 = closed
   ```
   **Fix**: Verific că backend rulează pe port 8000.

2. **SessionID mismatch**
   ```javascript
   // Verific ce sessionId am salvat
   console.log('SessionID locally:', localStorage.getItem('sessionId-0'));
   // Și compari cu ce zice starea din WebSocket
   ```
   **Fix**: Refresh page-ul și re-open WebSocket.

3. **Backend nu a primit comanda**
   ```bash
   # În terminal backend (rulează `poetry run uvicorn`)
   # Cauta log: "Client connected to box X"
   # și "Broadcast to box X"
   ```
   **Fix**: Verific că comanda e trimisă cu `POST /api/cmd`.

---

### Problema: JSON.parse error la localStorage

**Simptom**: Consola arată "Unexpected token"

```javascript
// GREȘIT
const boxes = JSON.parse(localStorage.getItem('listboxes'));
// Dacă localStorage e gol, JSON.parse(null) → error!

// CORECT
const boxesRaw = localStorage.getItem('listboxes');
if (boxesRaw) {
  try {
    const boxes = JSON.parse(boxesRaw);
    // Acum e sigur
  } catch (e) {
    console.warn('Invalid JSON in localStorage:', e);
    // Fallback: clear și reinitializează
    localStorage.removeItem('listboxes');
  }
} else {
  // localStorage e gol, use default
  const boxes = [];
}
```

---

### Problema: CORS Error

**Simptom**: Consola arată "Access to XMLHttpRequest at 'http://localhost:8000/api/cmd' from origin 'http://localhost:5173' has been blocked by CORS policy"

**Cauza**: Frontend și backend e pe porturi diferite. Browser-ul crede că e rău.

**Fix**: Backend trebuie să spună "e OK pentru 5173"

```python
# escalada/main.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

### Problema: Timer nu se sincronizează

**Simptom**: Timer-ul pe ControlPanel zice 3:45, pe Judge zice 4:12.

**Cauza**: 2 tab-uri rulează timer-ul local în JavaScript, fiecare cu propria pagină.

**Fix**: Timer-ul trebuie să ruleze pe **server**, nu pe client.

```python
# Backend (escalada/api/live.py)
import asyncio
from datetime import datetime

async def timer_task(box_id, duration_sec):
    """Rulează timer-ul pe server"""
    start_time = datetime.now()
    
    while True:
        elapsed = (datetime.now() - start_time).total_seconds()
        remaining = max(0, duration_sec - elapsed)
        
        # Broadcast timestamp current la toți clienții
        await broadcast_to_box(box_id, {
            'type': 'TIMER_SYNC',
            'remaining_seconds': remaining,
            'server_timestamp': datetime.now().isoformat()
        })
        
        if remaining <= 0:
            break
        
        await asyncio.sleep(0.1)  # Update la fiecare 100ms
```

```javascript
// Frontend - Crede server-ul, nu ceasul local
let timerDisplay = 300;  // 5 minute

const channel = new WebSocket('ws://localhost:8000/api/ws/box/0');
channel.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'TIMER_SYNC') {
    // Sincronizeaza cu serverul
    timerDisplay = msg.remaining_seconds;
    updateUI(timerDisplay);
  }
};
```

---

### Debug utilities

```javascript
// În consola browserului (F12)

// 1. Vezi toată starea box-ului
console.table(JSON.parse(localStorage.getItem('listboxes')));

// 2. Simulează o comandă
fetch('http://localhost:8000/api/cmd', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    boxId: 0,
    type: 'PROGRESS_UPDATE',
    increment: 1,
    sessionId: localStorage.getItem('sessionId-0')
  })
}).then(r => r.json()).then(console.log);

// 3. Citeți WebSocket log-uri
// (daca ai setup: window.wsLog = []; ws.onmessage = (e) => window.wsLog.push(e.data))
console.table(window.wsLog);
```

---

### Loguri Backend

```bash
# Tail live log-uri (pe Linux/Mac)
tail -f Escalada/escalada.log

# Sau direct în terminal unde rulează uvicorn
# INFO: "Client connected to box 0"
# WARNING: "Box 0: stale_session received"
# ERROR: "Validation failed: ..."
```

---

### Dacă nimic nu merge...

1. **Backend e pornit?**
   ```bash
   curl http://localhost:8000/docs
   # Dacă iți dă HTML, backend merge. Dacă e error, start-il.
   ```

2. **Frontend e pornit?**
   ```bash
   curl http://localhost:5173
   # Dacă iți dă HTML, front merge. Dacă e error, start-il.
   ```

3. **Repornește totul**
   ```bash
   # Stop backend (CTRL+C în terminal)
   # Stop frontend (CTRL+C în terminal)
   
   # Șterge cache
   rm -rf Escalada/.venv node_modules Escalada/escalada-ui/node_modules
   
   # Reinstalează
   cd Escalada && poetry install
   cd escalada-ui && npm install
   
   # Repornește
   poetry run uvicorn escalada.main:app --reload --port 8000
   npm run dev
   ```

## 10. Bune practici în proiectul Escalada

### 1. **Trimite mereu sessionId în comenzi**

După ce primești `STATE_SNAPSHOT`, salvează `sessionId`:

```javascript
// GREȘIT - Nu trimit sessionId
fetch('/api/cmd', {
  body: JSON.stringify({ boxId: 0, type: 'PROGRESS_UPDATE', increment: 1 })
});

// CORECT
const sessionId = localStorage.getItem(`sessionId-${boxId}`);
fetch('/api/cmd', {
  body: JSON.stringify({
    boxId: 0,
    type: 'PROGRESS_UPDATE',
    increment: 1,
    sessionId: sessionId  // ← IMPORTANT
  })
});
```

**De ce**: Fără sessionId, comenzile vechi din ferestre inchise pot corupta Box-ul nou.

---

### 2. **Loghează erorile, nu le ignora**

```javascript
// GREȘIT
try {
  const data = JSON.parse(something);
} catch {}  // Silent ignore!

// CORECT
try {
  const data = JSON.parse(something);
} catch (e) {
  console.error('JSON parse failed:', e);
  // Setez default sau returnez null
  return null;
}
```

**De ce**: Erorile silențioase fac debugging extrem de greu.

---

### 3. **Validează date pe ambe părți**

- **Backend**: Pydantic validators (ValidatedCmd)
- **Frontend**: Verificări JavaScript

```javascript
// Frontend validation
const startTimer = (boxId, durationSec) => {
  // Verific logica locala
  if (boxId < 0) {
    console.error('Invalid boxId');
    return;
  }
  
  if (durationSec < 1 || durationSec > 600) {
    console.error('Duration must be 1-600 seconds');
    return;
  }
  
  // Abia după ce validez, trimit
  fetch('/api/cmd', {
    body: JSON.stringify({ boxId, type: 'START_TIMER', duration: durationSec })
  });
};
```

---

### 4. **Debounce pentru operații frecvente**

Dacă utilizatorul apasă rapid "+1 Hold", nu trimite 1000 cereri pe secundă:

```javascript
// utilis/debounce.js
export const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

// Folosire
const handleProgressUpdate = debounce((increment) => {
  fetch('/api/cmd', {
    body: JSON.stringify({
      boxId: currentBoxId,
      type: 'PROGRESS_UPDATE',
      increment,
      sessionId: getSessionId(currentBoxId)
    })
  });
}, 300);  // Max 1 cerere la 300ms = ~3 cereri/sec max
```

---

### 5. **Rekonexiune automată la WebSocket**

Dacă rețeaua cade, clientul trebuie să se reconecteze:

```javascript
// Nu face manual: 
// const ws = new WebSocket(...);

// Folosește hook-ul din proiect:
import { useWebSocketWithHeartbeat } from './utilis/useWebSocketWithHeartbeat';

// Asta face automat:
// - Conexiune
// - Heartbeat (ping/pong la 30s)
// - Auto-reconnect cu exponential backoff (3s, 6s, 12s, ...)
// - Cleanup la unmount
const ws = useWebSocketWithHeartbeat(`ws://localhost:8000/api/ws/box/${boxId}`);
```

---

### 6. **State consistency - Fii consistent cu localStorage**

```javascript
// GREȘIT - Starea e fragmentată
const [boxName, setBoxName] = useState('');
const [boxId, setBoxId] = useState(null);
// Sunt independente, pot desynca

// CORECT - Starea unificată
const { boxes, setBoxes } = useAppState();
// sau
const boxes = useMemo(() => {
  const cached = localStorage.getItem('listboxes');
  return cached ? JSON.parse(cached) : [];
}, []);
```

---

### 7. **Type safety cu TypeScript**

```typescript
// GREȘIT - Any type (piezi validarea)
const processCommand = (cmd: any) => {
  // compiler nu știe ce e în cmd
  return cmd.boxId;  // Să fie sigur?
};

// CORECT - Tipuri explicite
interface Command {
  boxId: number;
  type: 'START_TIMER' | 'STOP_TIMER' | 'PROGRESS_UPDATE';
  sessionId?: string;
}

const processCommand = (cmd: Command) => {
  return cmd.boxId;  // Compiler știe că e number
};
```

---

### 8. **Accessibility (a11y) - Fă-o ușor de folosit**

```jsx
// GREȘIT
<button onClick={handleStart}>►</button>

// CORECT
<button 
  onClick={handleStart}
  aria-label="Start competition timer"
  title="Start timer (Ctrl+S)"
>
  ► Start
</button>
```

Persoanele cu deficiențe de vedere folosesc screen readers. Iar textul e mai ușor de înțeles decât icoană.

---

### 9. **Versionare - Commit mesaje descriptive**

```bash
# GREȘIT
git commit -m "fixes"
git commit -m "update"

# CORECT
git commit -m "feat: add debounce to PROGRESS_UPDATE to reduce spam"
git commit -m "fix: sessionId not sent in ControlPanel commands"
git commit -m "docs: add debugging section to CURS_INTRO_APLICATIE.md"
```

Mesaje bune = ușor să cauți ce s-a schimbat și de ce.

---

### 10. **Testing - Acoperă cazurile "ciudate"**

```python
# GREȘIT - Testez doar happy path
def test_progress_update():
    cmd = { 'increment': 1 }
    response = process(cmd)
    assert response.status == 200

# CORECT - Testez edge cases
def test_progress_update_invalid_increment():
    assert process({ 'increment': -1 }).status == 400
    assert process({ 'increment': 2 }).status == 400
    assert process({ 'increment': 'abc' }).status == 400

def test_progress_update_missing_boxId():
    assert process({ 'increment': 1 }).status == 400
    # (boxId lipsă)
```

## 11. Comenzi utile - "Cheatsheet" pentru dezvoltare

### Git - Versionare cod

```bash
# Verific status
git status

# Adaug fișiere în staging (preg pentru commit)
git add .              # Toate fișierele
git add escalada/      # Doar folderul backend

# Commit (salvez schimbări cu mesaj)
git commit -m "feat: add debounce to progress updates"

# Push (upload pe GitHub)
git push origin main

# Vezi historia
git log --oneline -10

# Anulezi últimul commit (dar păstrezi codul)
git reset --soft HEAD~1

# Arunc últimul commit complet
git reset --hard HEAD~1

# Vezi ce s-a schimbat în fișier
git diff escalada/main.py
```

---

### Backend - Poetry și Uvicorn

```bash
cd Escalada

# Instalează dependențe (o dată)
poetry install

# Pornește server
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000

# Adaug dependență nouă
poetry add requests

# Șterge cache Python
find . -type d -name __pycache__ -exec rm -r {} +

# Vezi environment-ul curent
poetry env info

# Rulează teste
poetry run pytest tests/ -v
poetry run pytest tests/test_live.py::test_init_route_basic -v

# Formatare automată
poetry run black escalada/
poetry run isort escalada/
```

---

### Frontend - npm și Vite

```bash
cd Escalada/escalada-ui

# Instalează dependențe (o dată)
npm install

# Dev server (cu hot reload)
npm run dev

# Adaug dependență nouă
npm install lodash

# Formatare automată
npm run format

# Linting (verific cod)
npm run lint

# Rulează teste
npm test -- --run
npm test                    # Interactive mode

# Coverage
npm run test:coverage

# E2E
npm run test:e2e

# Build pentru production
npm run build

# Preview build-ul
npm run preview

# Șterge node_modules (dacă e stricat ceva)
rm -rf node_modules
npm install
```

---

### Docker (optional - pentru production)

```bash
# Build image
docker build -t escalada-backend -f Escalada/Dockerfile .

# Run container
docker run -p 8000:8000 escalada-backend

# Logs
docker logs <container_id>

# Stop
docker stop <container_id>
```

---

### TypeScript - Type checking

```bash
cd Escalada/escalada-ui

# Verific tipuri (fără a rula cod)
npx tsc --noEmit

# Generat types din Python (optional)
npx quicktype -s schema escalada.json -o src/types/Generated.ts
```

---

### Debugging Tools

```javascript
// Browser DevTools (F12)
console.log(message)           // Mesaj
console.table(array)           // Tabel
console.warn('warning')        // Avertisment (galben)
console.error('error')         // Eroare (roșu)
console.time('label')
// ... cod
console.timeEnd('label')       // Cât de mult timp a luat

// Breakpoints
// Apasă linia de cod din DevTools → oprește executia când ajunge acolo

// Network tab
// Vezi toate request-urile (HTTP, WebSocket) și răspunsurile
```

---

### Profiling Performance

```bash
# Backend - ce funcții sunt lente?
poetry run python -m cProfile escalada/main.py

# Frontend - ce component-e re-render prea des?
# React DevTools Browser Extension (chrome/firefox)
# Profiler tab → Record → Run code → Analizează
```

---

### Database (dacă adăugi bază de date)

```bash
# SQLite (simplă)
sqlite3 escalada.db
sqlite> SELECT * FROM boxes;

# PostgreSQL (producție)
psql -U postgres -d escalada
escalada=# SELECT COUNT(*) FROM competitions;
```

---

### Environment variables

```bash
# Crează .env file
echo "DEBUG=1" > .env
echo "API_URL=http://localhost:8000" >> .env

# Citește în Python
import os
DEBUG = os.getenv('DEBUG', '0') == '1'
API_URL = os.getenv('API_URL', 'http://localhost:8000')

# Citește în JavaScript
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
// ⚠️ Variabilele trebuie să înceapă cu REACT_APP_
```

## 12. Următorii pași - Cum contribui cu cod nou

### Workflow: Features și Bug Fixes

```bash
# 1. Creez branch nou pentru feature
git checkout -b feat/improve-timer-display

# 2. Fac schimbări în cod
# (edit fișiere...)

# 3. Testez local
npm test -- --run          # Frontend
poetry run pytest          # Backend

# 4. Commit schimbările
git add .
git commit -m "feat: improve timer display to show milliseconds"

# 5. Push pe branch
git push origin feat/improve-timer-display

# 6. Crezi Pull Request pe GitHub
# (GitHub îți va arăta un buton "Create PR")

# 7. Aștepți review și merge
```

---

### Exemplu: Adaug o funcție nouă

**Feature**: Vreau să marchez "Flag" un alpinist care a renunțat.

**Pași**:

1. **Crezi branch**
   ```bash
   git checkout -b feat/flag-competitor
   ```

2. **Adaug backend (Pydantic validator)**
   ```python
   # escalada/validation.py
   class FlagCompetitorCmd(BaseModel):
       boxId: int
       competitorName: str
       flagged: bool
       
       @field_validator('competitorName')
       @classmethod
       def validate_name(cls, v):
           if len(v) < 1:
               raise ValueError('Name required')
           return v
   ```

3. **Adaug handler în live.py**
   ```python
   # escalada/api/live.py
   elif cmd.type == 'FLAG_COMPETITOR':
       competitor = find_competitor(state, cmd.competitorName)
       if competitor:
           competitor['flagged'] = cmd.flagged
           broadcast_to_box(...)
   ```

4. **Adaug action frontend**
   ```javascript
   // escalada-ui/src/utilis/contestActions.js
   export const flagCompetitor = async (boxId, name, flagged) => {
     const response = await fetch(API_CP, {
       method: 'POST',
       body: JSON.stringify({
         boxId,
         type: 'FLAG_COMPETITOR',
         competitorName: name,
         flagged,
         sessionId: getSessionId(boxId)
       })
     });
     return response.json();
   };
   ```

5. **Adaug UI în JudgePage**
   ```jsx
   // escalada-ui/src/components/JudgePage.tsx
   <button 
     onClick={() => flagCompetitor(boxId, competitor.name, true)}
     aria-label="Flag competitor"
   >
     🚩 Flag
   </button>
   ```

6. **Adaug test backend**
   ```python
   # escalada/tests/test_live.py
   def test_flag_competitor():
       cmd = {
           'boxId': 0,
           'type': 'FLAG_COMPETITOR',
           'competitorName': 'Alice',
           'flagged': True,
           'sessionId': 'test-session'
       }
       response = client.post('/api/cmd', json=cmd)
       assert response.status_code == 200
       assert state_map[0]['competitors'][0]['flagged'] == True
   ```

7. **Adaug test frontend**
   ```javascript
   // escalada-ui/src/__tests__/JudgePage.test.jsx
   test('flag button marks competitor as flagged', async () => {
     render(<JudgePage boxId={0} />);
     
     const flagBtn = screen.getByLabelText('Flag competitor');
     fireEvent.click(flagBtn);
     
     expect(mockFetch).toHaveBeenCalledWith(
       expect.stringContaining('api/cmd'),
       expect.objectContaining({
         body: expect.stringContaining('FLAG_COMPETITOR')
       })
     );
   });
   ```

8. **Commit și push**
   ```bash
   git add .
   git commit -m "feat: add flag competitor functionality"
   git push origin feat/flag-competitor
   ```

9. **GitHub Action rulează automat**
   - ✓ Backend tests
   - ✓ Frontend tests
   - ✓ E2E tests
   - ✓ Linting & formatting
   
   Dacă toate trec → poți merge în main!

---

### Code Review Checklist

Cand cineva cere review la PR-ul tău, verific:

- [ ] Codul e formatat (black, prettier)
- [ ] Tipurile sunt corecte (TypeScript, no `any`)
- [ ] Testele trec (100%)
- [ ] Mesajul de commit e descriptiv
- [ ] Nu am hardcodat valori (use env vars)
- [ ] SessionID e inclus în comenzi (dacă e relevant)
- [ ] WebSocket reconnect-ul e corect (dacă am adăugat WS)
- [ ] Documentația e actualizată (README, CURS_INTRO)

---

### Cum să citesc și să înțeleg codul existent

```bash
# 1. Urmăresc o rută
# Vreau să Vezi ce se întâmple când apas "Start Timer"

# Caut în contestActions.js
grep -r "START_TIMER" Escalada/escalada-ui/src

# Găsesc: contestActions.js face POST /api/cmd

# Caut în backend
grep -r "START_TIMER" Escalada/escalada

# Găsesc: api/live.py linia X are handler

# Citesc cod-ul în jur
vim Escalada/escalada/api/live.py +X

# Caut ce stare se schimbă
grep -A5 "elif cmd.type == 'START_TIMER':" Escalada/escalada/api/live.py

# Caut test-uri
grep -r "START_TIMER" Escalada/tests

# Citesc test-ul pentru a înțelege ce ar trebui să se întâmple
vim Escalada/tests/test_live.py
```

---

### Resurse și documentație suplimentară

| Resursă | Link |
|---------|------|
| FastAPI docs | https://fastapi.tiangolo.com/ |
| React docs | https://react.dev |
| WebSocket guide | https://developer.mozilla.org/en-US/docs/Web/API/WebSocket |
| Pydantic validation | https://docs.pydantic.dev/latest/concepts/validators/ |
| Vitest docs | https://vitest.dev/ |
| Playwright docs | https://playwright.dev/ |
| Project README | `Escalada/README.md` |
| Bug history | `BUGFIX_SUMMARY.md`, `BUGFIX_NEXT_ROUTE_AND_CORS.md` |
| Copilot instructions | `.github/copilot-instructions.md` |
