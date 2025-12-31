# Plan Imbunatatiri Escalada 2026

Data: 29 decembrie 2025  
Status: Propuneri structurate pe prioritati (1-20)

---

## Cuprins

- Prioritate Inalta: [#1 Persistenta](#p1) · [#2 RBAC](#p2) · [#3 Backup/Export](#p3) · [#4 Separarea state](#p4) · [#5 Offline-first](#p5)
- Prioritate Medie: [#6 Monitoring](#p6) · [#7 Rate limiting](#p7) · [#8 UI/UX](#p8) · [#9 E2E](#p9) · [#10 API Docs](#p10)
- Prioritate Scazuta: [#11 Mobile](#p11) · [#12 Video](#p12) · [#13 i18n](#p13) · [#14 Analytics](#p14) · [#15 Push](#p15) · [#16 Hardware](#p16)
- Refactoring: [#17 Backend modularizare](#p17) · [#18 Frontend splitting](#p18) · [#19 Shared validation](#p19)
- Security: [#20 CSP](#p20) · [#21 HTTPS](#p21)
- [Roadmap Sugerat](#roadmap-sugerat)
- [Next Steps](#next-steps)

## Prioritate Inalta

<a id="p1"></a>
1) Persistenta backend cu baza de date
- Problema: state_map este in memorie; restart == pierdere totala.
- Solutie: PostgreSQL + SQLAlchemy.
- Modele cheie: Competitions, Boxes, Competitors, Events (audit trail).
- Beneficii: recovery dupa crash, istoric competitii, analytics, pregatire multi-server.
- Plan migrari/seed + rollback:
	- Alembic pentru migrari versionate (upgrade/downgrade) cu audit al schimbărilor.
	- Script seed inițial idempotent (creează competiție demo, boxe, categorii, competitori) — rulare: `poetry run python -m escalada.scripts.seed`.
	- Rollback sigur prin `alembic downgrade` și snapshot SQL înainte de upgrade; DDL tranzacțional unde e suportat.
	- Gate de calitate în CI: `upgrade -> seed -> teste integritate -> downgrade -> upgrade -> teste` pentru a prinde blocaje.
- Teste de integritate (pytest):
	- Constrângeri: chei străine, unicitate (`boxId + routeIndex`), cascade/ON DELETE.
	- Idempotenta seed: rulări repetate nu dublează datele.
	- Concurență: inserții paralele de evenimente cu lock-uri/transaction isolation.
	- Migrare round-trip: datele rămân consistente după `downgrade` + `upgrade`.

<a id="p2"></a>
2) Autentificare si autorizare completa
- Problema: auth.py nefolosit, fara roluri.
- Solutie: RBAC (admin, judge, viewer) cu assignedBoxes pentru judge.
- ControlPanel doar admin, JudgePage doar judge alocat, ContestPage read-only.
 - Matrice permisiuni (API + WebSocket):
 	- HTTP
 		- GET /api/*: admin, judge (doar resurse proprii), viewer (doar public)
 		- POST /api/cmd: admin (toate box-urile, toate tipurile), judge (numai box-urile alocate; INIT_ROUTE, START/PAUSE/RESET_TIMER, PROGRESS_UPDATE, SET_ACTIVE_CLIMBER, SCORE_UPDATE, NEXT_COMPETITOR/NEXT_ROUTE), viewer: interzis
 	- WebSocket /ws/box/{boxId}
 		- Subscribe: admin (oricare), judge (numai box alocat), viewer (read-only)
 		- Evenimente trimise (prin cmd): aceleași restricții ca la POST /api/cmd
 - Enforcement uniform:
 	- Depends/guard comun care validează `role` + `assignedBoxes` înaintea validărilor comenzii.
 	- JWT payload include `role`, `userId`, `assignedBoxes` pentru evaluare rapidă.
 	- Erori standardizate: `forbidden_role`, `forbidden_box`, `forbidden_action`.
 - Coduri de eroare & handling frontend:
	- HTTP 401: `invalid_token` / `token_expired` → curăță token-ul și afișează ecran de login.
	- HTTP 403: `forbidden_role` / `forbidden_box` → mesaj „nu ai acces la acest box”, oprește acțiunea.
	- WS close: 4401 `token_required`/`invalid_token`, 4403 `forbidden_box_or_role` → închide socket-ul, redirecționează la login.

<a id="p3"></a>
3) Backup si export date
- Solutie: Export CSV/Excel per box, export JSON complet, auto-backup la 5 minute.
- Beneficiu: siguranta datelor de concurs.
- Unificare stocare + ordine RESTORE:
	- Stocare principală: IndexedDB prin Service Worker (Background Sync); localStorage doar fallback (pointer la ultimul snapshot: id + timestamp).
	- Serializer unic (JSON schema comună) pentru backup și offline queue, cu câmpuri `boxVersion` + `sessionId` pentru consistență.
	- Ordine restore: (1) ultimul snapshot confirmat de server (<TTL 15min); (2) cel mai recent snapshot din IndexedDB; (3) fallback localStorage dacă IndexedDB indisponibil.
	- Rezolvare conflicte: preferă setul cu `boxVersion` mai mare; la egalitate, alege cel cu `sessionId` curent; altfel cere confirmare operator.
 - Politica de conflict (backup/export vs server):
 	- Scalars (ex. `timerPreset`, `holdsCount`): Last‑Write‑Wins pe `serverTimestamp` > `clientTimestamp`.
 	- Liste ordonate (coada competitori): merge stabil, păstrăm ordinea serverului și inserăm elementele client lipsă după poziția declarată; logăm diferențele.
 	- Deduplicare evenimente: cheie pe `actionId` (dacă prezent) sau hash(payload)+time bucket.

<a id="p4"></a>
4) Separarea contest state in doua ferestre
- Scop: minimizare re-render si claritate a datelor in ContestPage/JudgePage.
- Structura: 1.1 ranking state (clasament live, scoruri, timpi, podium); 1.2 competitor state (climbing/preparing/remaining, timer/progress, restul informatiilor curente).
- Solutie: doua contexte React (RankingContext + CompetitorQueueContext) injectate in ContestPage; persistenta numai pentru ranking, queue ramane efemer.
- Beneficiu: performanta mai buna, testare separata (ranking vs coada), risc redus de desincronizare.

<a id="p5"></a>
5) Offline-first si sincronizare
- Solutie: Service Worker + IndexedDB; queue comenzi când backend este down; sync automat la reconectare; indicator UI "Offline mode - changes will sync".
- Integrare cu backup (#3): același IndexedDB store pentru queue + snapshot-uri, cu canale separate; policy de restore din #3 se aplică înainte de replay comenzi.
 - Conflict resolution (offline vs online):
 	- Replay ordonat după `clientTimestamp` (stabil) cu validare `boxVersion` și `sessionId`; la mismatch: marcăm `stale_session` și nu aplicăm comanda.
 	- LWW pentru câmpuri scalare; comenzi idempotente folosesc `actionId` pentru dedup.
 	- Evenimente expirate: TTL 30m sau invalidare la creștere `boxVersion`/schimbare `sessionId`; mutare în Dead‑Letter Queue (DLQ) cu opțiuni UI `Retry`, `Discard`, `Export`.

---

## Prioritate Medie

<a id="p6"></a>
6) Logging si monitoring imbunatatit
- Solutie: structured logging (JSON), metrics (latency, WS connections, error rate), /health endpoint, Sentry/Rollbar.
 - Correlation & context:
 	- `request_id`/`correlation_id` generat la edge pentru HTTP și propagat în WS; inclus în broadcast și răspunsurile la comenzi.
 	- Log fields: `request_id`, `userId`, `role`, `boxId`, `action`, `clientVersion` (UI), `boxVersion`, `sessionId`, `ip`, `userAgent`.
 	- Header: acceptăm `X-Request-ID` (propagăm) sau generăm dacă lipsește.
 	- Tracing: OpenTelemetry (FastAPI + frontend fetch) cu span-uri `cmd` și `broadcast`.

<a id="p7"></a>
7) Rate limiting mai granular
- Solutie: per-user rate limit post-autentificare (admin unlimited, judge 120/min per box, viewer 10/min read). Adaptive throttling + whitelist.
 - Matrice throttling per rol + acțiune:
 	- Chei: `{role}:{userId}:{boxId}:{action}` + bucket global `:{boxId}:*`.
 	- Praguri propuse: `PROGRESS_UPDATE` (judge) 120/min; `START/PAUSE/RESET_TIMER` 20/min; `SET_ACTIVE_CLIMBER`/`SCORE_UPDATE` 60/min; admin mgmt 30/min; viewer GET 60/min IP‑based.
	- Răspuns: HTTP 429 + `Retry-After`; WS emite `RATE_LIMITED` către client.
	- Scope pe WebSocket: blocarea se aplică DOAR pe cheia încălcată (`{boxId}:{action}` pentru acel `userId`/rol). Alte acțiuni și/sau alte box‑uri rămân funcționale; cooldown per‑cheie, nu global.
 	- Observabilitate: export metri cifice Prometheus (hits, drops, burst) pe chei agregate.

<a id="p8"></a>
8) UI/UX improvements
- ControlPanel: drag & drop competitori, bulk actions, shortcut-uri, dark mode, search/filter.
- JudgePage: undo/redo la progress, voice commands (optional), quick stats, timer warnings vizuale.
- ContestPage: QR link spectatori, animatii la scor, leaderboard top 3, sponsor logo configurabil.

<a id="p9"></a>
9) Testing E2E mai complet
- Solutie: Playwright pentru multi-user (2 judges + admin), network flakiness, load (10 boxe, 50 competitori/box), cross-browser (Safari, Firefox).

<a id="p10"></a>
10) Documentatie API (OpenAPI/Swagger)
- Solutie: setari FastAPI title/description/version, docs_url/redoc_url, docstrings la endpoint-uri cu rate limits si cerinte boxVersion/sessionId.

---

## Prioritate Scazuta (Nice to Have)

<a id="p11"></a>
11) Mobile app (React Native) pentru judges pe tableta/telefon.
<a id="p12"></a>
12) Integrare video streaming in ContestPage.
<a id="p13"></a>
13) Multi-language (i18n EN/FR/ES) cu react-i18next.
<a id="p14"></a>
14) Advanced analytics dashboard (heatmap holds, trenduri performanta, dificultate rute).
<a id="p15"></a>
15) Notificari push ("box-ul tau incepe in 5 minute").
<a id="p16"></a>
16) Hardware integration (buton USB pentru next hold, LED-uri pe perete, sonerie time's up).

---

## Refactoring Recomandat

<a id="p17"></a>
17) Backend modularizare
- Split live.py in api/commands.py, api/websocket.py, api/validators.py, services/box_service.py, services/timer_service.py, repositories/box_repo.py.

<a id="p18"></a>
18) Frontend code splitting
- ControlPanel.tsx -> subcomponente BoxCard, CompetitorList, TimerControls, RouteNavigation.

<a id="p19"></a>
19) Shared validation logic
- Pachet npm "escalada-shared" cu types.ts, validators.ts (Zod), constants.ts reutilizabile front/back.

---

## Security Suplimentara

<a id="p20"></a>
20) Content Security Policy (CSP)
- Politica recomandată (prod):
	- `default-src 'self'`;
	- `script-src 'self' 'nonce-{random}' 'strict-dynamic'` + (opțional) `https:` pentru CDN‑uri de încredere; evitați `unsafe-inline`.
	- `style-src 'self'` + hash/nonce pentru stiluri critice; mutați stilurile inline în CSS.
	- `img-src 'self' data:`; `font-src 'self'`.
	- `connect-src 'self' https: ws: wss:` pentru fetch și WebSocket către origini securizate.
	- `frame-ancestors 'none'` (fără embed extern) și `base-uri 'self'`.
- Mod dezvoltare:
	- Permiteți temporar `style-src 'unsafe-inline'` doar în dev dacă toolchainul o cere; nu includeți `unsafe-inline` la `script-src` nici în dev — folosiți `nonce`.
- Implementare:
	- Backend adaugă nonce per răspuns și îl injectează în tag‑urile `<script>`/`<style>` generate.
	- Build frontend fără inline scripts; pentru orice script necesar la runtime, folosiți `<script nonce="...">` sau încărcare din fișier separat.

<a id="p21"></a>
21) HTTPS Enforcer
- Middleware HTTPSRedirect in productie; HSTS activat; redirect HTTP->HTTPS.

---

## Roadmap Sugerat

Q1 2026: #2 RBAC, #1 PostgreSQL, #3 Backup/Export.  
Q2 2026: #5 Offline-first, #8 UX, #6 Monitoring.  
Q3 2026: #11 Mobile, #14 Analytics.  
Q4 2026: #12 Video streaming, #16 Hardware integration.

---

## Next Steps
- Alege prioritatile pentru iteratia curenta (recomand #1, #2, #3, #4).  
- Pot detalia implementare si livrabile per task la cerere.
