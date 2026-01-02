# Escalada — Checklist de implementare (end-to-end)

Checklist operațional pentru evoluția aplicației Escalada de la starea actuală
la o arhitectură stabilă, sigură și scalabilă pentru competiții reale.

Bifează doar ce este **realmente făcut**.

---

## ✅ ETAPA 0 — Claritate de bază (obligatoriu)

- [x] Pot explica în 2 propoziții ce problemă rezolvă aplicația
- [x] Pot spune clar ce NU face aplicația
- [x] Am identificat entry point-ul (`escalada/main.py`)
- [x] Am identificat „creierul” aplicației (logica de concurs)

_Notițe rapide: gestionează concursuri de escaladă live (box-uri, timere, scoruri, clasamente) cu sincronizare WebSocket + backup; nu acoperă streaming video, scoring avansat multi-round, integrare hardware. Entry: Escalada/escalada/main.py (FastAPI + bootstrap), logică de concurs + state live: Escalada/escalada/api/live.py (state_map, comenzi, broadcast)._

---

## ✅ ETAPA 1 — Model mental & arhitectură

### 1.1 Zonele aplicației (înțelese, nu neapărat separate)
- [x] CORE — reguli de concurs
- [x] STATE — starea live
- [x] API — FastAPI / WebSocket
- [x] UI — React
- [x] PERSIST — DB / backup

_Note: CORE + STATE actualmente în `Escalada/escalada/api/live.py` (logica comenzi + state_map + broadcast); API în `Escalada/escalada/api/*` (FastAPI + WS); UI în `Escalada/escalada-ui` (React/Vite); PERSIST în `Escalada/escalada/db/*` + `Escalada/escalada/api/backup.py` (persistență + backup JSON)._

### 1.2 Reguli de comunicare asumate
- [x] UI → API (doar)
- [x] API → CORE (doar)
- [x] CORE nu importă UI / API / DB
- [x] DB nu influențează decizii live

_Reguli: UI trimite exclusiv prin HTTP/WS către API; API validează și cheamă CORE; CORE expune doar funcții pure de stat; PERSIST/DB doar salvează/încarcă state, fără logică de decizie în live flow._

---

## ✅ ETAPA 1.5 — Mutări sigure (risc zero)

### Curățenie repo
- [x] `node_modules/` scos din repo
- [x] `dist/` scos din repo
- [x] `backups/*.json` mutate în afara repo-ului
- [x] `*.log` eliminate
- [x] `.DS_Store` eliminate
- [x] fișiere `.xlsx` eliminate sau mutate extern

_Note: node_modules, backup-urile JSON, fișierele `.xlsx` și `.DS_Store` sunt scoase din index + ignorate; log-urile locale au fost șterse. `dist/` rămâne doar local și ignorat._

### Claritate conceptuală
- [x] Am definit explicit ce fișiere = CORE
- [x] Am definit explicit ce fișiere = API
- [x] Am definit explicit ce fișiere = UI
- [x] Am definit explicit ce fișiere = PERSIST

_Boundary-uri curente:_  
- CORE: `Escalada/escalada/core/contest.py`, `Escalada/escalada/validation.py` (logică de state/validare, fără FastAPI/DB).  
- API: `Escalada/escalada/api/live.py`, `auth.py`, `podium.py`, `backup.py`, `save_ranking.py` (FastAPI/WS, transport).  
- UI: `Escalada/escalada-ui/src/**/*` (React).  
- PERSIST: `Escalada/escalada/db/*`, `escalada/api/backup.py` (persistență/snapshot), `escalada/db/migrate.py`.

---

## ✅ ETAPA 2A — CORE curat (refactor controlat)

### Obiectiv
CORE rulabil și testabil fără server.

- [x] CORE NU importă FastAPI
- [x] CORE NU importă WebSocket
- [x] CORE NU importă SQLAlchemy
- [x] CORE primește input → returnează output (fără side-effects externe)

### Testare
- [x] Pot rula teste de concurs fără să pornesc serverul
- [x] Pot simula un concurs complet doar din teste
- [x] Regulile sunt testate independent de UI

_Note: Logica de stat/command a fost extrasă în `Escalada/escalada/core/contest.py`; API-ul doar delegă. Teste pure în `Escalada/tests/test_core_contest.py` rulează fără FastAPI/DB (validat). Pentru integrare DB, folosește Postgres din `docker-compose up db` sau setează `TEST_DATABASE_URL`; fallback skip dacă DB inaccesibil._

---

## ✅ ETAPA 2B — Blindarea stării (siguranță)

### Persistență stare
- [x] Starea concursului este serializabilă
- [x] Snapshot automat la interval sau la evenimente cheie
- [x] Restore automat la pornirea serverului

### Comportament la erori
- [x] Restart server ≠ pierdere concurs
- [x] SessionId / versioning funcționează după restore
- [x] Comenzile stale sunt refuzate clar

_Note: state_map este JSON-serializabil (dict/list/number/str), persistat la fiecare comandă prin DB (JSONB) + backup periodic în `main.py` (BACKUP_INTERVAL_MIN). La startup se rulează migrații + `preload_states_from_db()` pentru restaurare automată din DB; versiune/sessionId sunt hidratate și validate (stale ignorate). Backup periodic menține snapshot-uri, iar `backup.py` permite export/restore manuale._

---

## ✅ ETAPA 2C — Separare repo-uri (opțional, dar recomandat)

- [x] `escalada-core` (logică pură)
- [x] `escalada-api` (FastAPI, auth, DB)
- [x] `escalada-ui` (React)

_Repo-uri reale create (ready to push):_
- _CORE: `repos/escalada-core` (pachet `escalada_core`, CI separat)_
- _API: `repos/escalada-api` (pachet `escalada`, CI separat + Postgres service)_
- _UI: `repos/escalada-ui` (React/Vite, CI separat)_

_Notă CI cross-repo:_ dacă `escalada-core` este privat, setează în repo-ul `escalada-api` secretul `ESCALADA_CORE_TOKEN` (PAT cu access read la `escalada-core`) ca workflow-ul să poată face checkout la CORE.

### Beneficii verificate
- [x] Pot lucra la UI fără backend
- [x] Pot testa CORE fără web
- [x] CI separat per repo

---

## ✅ ETAPA 3 — Nivel competițional mare (opțional)

- [x] Backup automat verificat (drill test: `repos/escalada-api/tests/test_backup_restore_drill.py`)
- [x] Export rezultate oficiale (ZIP: `GET /api/admin/export/official/box/{box_id}`)
- [x] Audit log (cine a făcut ce)
- [x] Fail-safe pentru rețea / restart (drill: `POST /api/admin/ops/drill/backup_restore`)
- [x] Documentație de operare pentru concurs (`repos/escalada-api/RUNBOOK_CONCURS.md`)

---

## ✅ CRITERII FINALE DE ACCEPTANȚĂ

Aplicația este considerată „gata de concurs” dacă:

- [ ] Regulile de concurs sunt într-un singur loc
- [ ] UI nu conține logică de concurs
- [ ] API este doar transport
- [ ] Restartul nu pierde starea
- [ ] Testele validează scenarii reale de concurs

---

## PRINCIPIU FINAL (de respectat permanent)

- [ ] Nu adaug logică de concurs în UI
- [ ] Nu adaug reguli în API
- [ ] Nu leg DB-ul de flow-ul live
- [ ] Nu optimizez înainte de claritate

Sfârșit.
