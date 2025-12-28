# Ghid rapid pentru aplicatia Escalada (suport de curs)

Documentul acesta explica, pe scurt, cum este organizata aplicatia, cum se ruleaza si ce fluxuri principale are. Este gandit pentru un programator incepator care vrea sa inteleaga repede proiectul.

## 1. Arhitectura
- **Backend**: Python + FastAPI (`Escalada/escalada`). Expune HTTP (`/api/cmd`, `/api/state/{box_id}`, `/api/save_ranking`) si WebSocket (`/api/ws/{box_id}`).
- **Frontend**: React/Vite (`Escalada/escalada-ui`). Componente principale: `ControlPanel` (organizator), `JudgePage` (arbitru), `ContestPage` (afisare live).
- **Comunicare in timp real**: WebSocket per box (ID-ul boxului este in URL). Snapshot-ul de stare se trimite pe WS, iar comenzile Judge/ControlPanel se trimit prin HTTP `POST /api/cmd`.
- **Persistenta locala**: `localStorage` pentru valori temporare (timer, sesiune box, climberi curenti, clasamente cache).

## 2. Structura de directoare (esential)
- `Escalada/escalada/` – backend (FastAPI, rute, validari).
- `Escalada/escalada-ui/` – frontend (React).
- `Escalada/tests/` – teste backend (pytest).
- `Escalada/escalada-ui/src/__tests__/` – teste frontend (Vitest).

## 3. Rulare in dezvoltare
```bash
# Backend
cd Escalada
poetry install               # o singura data
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd escalada-ui
npm install                  # o singura data
npm run dev                  # porneste Vite pe 5173 (implicit)
```

## 4. Fluxul competitiei (simplificat)
1. **ControlPanel** creeaza box-uri (listboxes) si face `INIT_ROUTE` pentru fiecare: `/api/cmd` cu `type: INIT_ROUTE`, `boxId`, `holdsCount`, `competitors`.
2. Backend genereaza un `sessionId` per box; acesta apare in `STATE_SNAPSHOT`.
3. **JudgePage** se conecteaza la `/api/ws/{boxId}`, primeste `STATE_SNAPSHOT` si aplica starea (initiated, holdCount etc.). Comenzile trimise de Judge folosesc `sessionId` din snapshot.
4. **ControlPanel/Judge** trimit actiuni: `START_TIMER`, `STOP_TIMER`, `PROGRESS_UPDATE` (+1/+0.1), `SUBMIT_SCORE`. Backend broadcast-eaza pe WS spre toate ferestrele.
5. Clasamentele se genereaza din cache local + `/api/save_ranking`.

## 5. Endpoint-uri si mesaje cheie
- `POST /api/cmd` – comenzi competitionale. Tipuri: `INIT_ROUTE`, `START_TIMER`, `STOP_TIMER`, `RESUME_TIMER`, `PROGRESS_UPDATE`, `SUBMIT_SCORE`, `REQUEST_STATE`, `SET_TIME_CRITERION`, `ACTIVE_CLIMBER`, `REGISTER_TIME`, `TIMER_SYNC`.
- `GET /api/state/{box_id}` – snapshot de stare (folosit de Judge/ControlPanel la resync).
- `WS /api/ws/{box_id}` – primeste `STATE_SNAPSHOT`, `PROGRESS_UPDATE`, `TIME_CRITERION`, `TIMER_SYNC` etc.

## 6. Validare si sesiuni
- `ValidatedCmd` (backend) verifica tipuri/valori (timer preset `MM:SS`, competitori etc.).
- `sessionId` per box previne “state bleed” cand stergi/recreezi box-uri; clientii trebuie sa trimita `sessionId` in comenzi.
- Pentru testare se poate introduce un toggle de validare via env (ex. `ESCALADA_VALIDATION=0` citit in cod pentru a dezactiva validarea).

## 7. localStorage si sincronizare
- Chei tipice: `sessionId-{boxId}`, `boxVersion-{boxId}`, `timer-{boxId}`, `registeredTime-{boxId}`, `climbingTime` (preset global).
- Starea se sincronizeaza intre tab-uri prin evenimentul `storage` si, unde e nevoie, prin `BroadcastChannel`.

## 8. Testare
- **Backend**: `poetry run pytest` (testeaza rutele, WS, validarea).
- **Frontend**: `npm test -- --run` sau `npx vitest`. Pentru verificarea tipurilor: `npx tsc --noEmit`.
- E2E (Playwright) pot fi adaugate pentru flux complet ControlPanel/Judge/Contest.

## 9. Sfaturi de depanare
- Daca Judge nu se sincronizeaza: verifica in consola mesajele WS, asigura-te ca `STATE_SNAPSHOT` soseste si ca `sessionId` este setat.
- Daca apar erori `JSON.parse`: verifica valorile din `localStorage` (sa fie string valid sau sa ai try/catch cu fallback).
- Daca apar CORS: seteaza `ALLOWED_ORIGINS/ALLOWED_ORIGIN_REGEX` in backend (vezi `escalada/main.py`).

## 10. Bune practici in acest proiect
- Trimite mereu `sessionId` in comenzi dupa ce ai primit snapshot-ul initial.
- Nu lasa `catch {}` mute – logheaza erorile (ex. `console.warn` sau helper de debug).
- Pentru UI accesibil: adauga `aria-label` la butoane si testeaza navigarea cu tastatura.
- Debounce pentru `PROGRESS_UPDATE` daca ai multe click-uri rapide (reduce trafic).

## 11. Comenzi utile git/npm/poetry
- `git status`, `git add .`, `git commit -m "mesaj"`, `git push origin <branch>`
- `poetry run uvicorn escalada.main:app --reload`
- `npm run dev` (frontend), `npm test -- --run`, `npx tsc --noEmit`

Acest ghid acopera elementele de baza; pentru detalii suplimentare vezi `README.md` si fisierele din proiect. Practicează rularea backend + frontend, apoi urmareste logurile WS in Judge/ControlPanel ca sa intelegi fluxul complet.
