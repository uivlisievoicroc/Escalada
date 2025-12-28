# Escalada — Sistem de management pentru competiții de escaladă (Prezentare pentru ofertare)

## Rezumat Executiv
Escalada este un sistem complet pentru organizarea și arbitrarea competițiilor de escaladă, cu sincronizare în timp real între panoul de control (operator) și interfața de arbitraj (judge). Platforma combină un backend robust (FastAPI + WebSockets) cu un frontend modern (React + Vite), acoperind funcționalități esențiale precum cronometraj, scorare, clasamente și vizualizare podium. Siguranța și fiabilitatea sunt prioritare: validare strictă a datelor, rate limiting, izolare de sesiune, heartbeat pentru conexiuni WebSocket, acoperire OWASP Top 10 și o suită extinsă de teste automate.

## Probleme Rezolvate
- Arbitraj în timp real cu prevenirea comenzilor „fantomă” din tab-uri vechi (izolare prin `sessionId`).
- Conexiuni WebSocket robuste cu heartbeat (PING/PONG) și auto-reconectare.
- Protecție DoS prin rate limiting per box și per comandă.
- Validare strictă a inputului (Pydantic v2) pentru a preveni XSS/SQL injection.
- Sincronizare între tab-uri (BroadcastChannel + localStorage) și între dispozitive (WebSockets).

## Funcționalități Cheie
- Control Panel (operator):
  - Inițiere traseu, setare timp, start/stop/resume cronometru.
  - Incrementare progres (+1 / +0.1) cu blocaje la atingerea „top” (hold limite).
  - Selectare competitor activ și trimitere scor.
  - Generare clasamente și export.
  - Deschidere rapidă interfață Judge + QR pentru acces ușor.
- Judge Page (arbitru):
  - Vizualizare timp rămas, scor curent, competitor activ.
  - Trimitere scor și „registered time” (criteriu de timp opțional).
- Live Sync:
  - WebSockets cu heartbeat la 30s și timeout la 60s.
  - Snapshots de stare la cerere și la evenimente de scor.
- Securitate:
  - Validare intrări cu Pydantic v2, sanitizare nume competitori.
  - JWT pentru endpoints autentificate (HS256, expirare 15 min).
  - Rate limiting: 60 req/min pe box, 10 req/sec, limite per comandă (ex. 120/min pentru PROGRESS_UPDATE).
- Fiabilitate & UX:
  - Izolare sesiuni per box (token `sessionId`), prevenirea „state bleed” după ștergeri.
  - Reindexare automată a datelor locale după delete pentru consistență.
  - Garduri UI care previn depășirea „holdsCount”.

## Avantaje Competitive
- „Real-time first”: conceput pentru latență redusă și sincronizare fiabilă.
- Siguranță enterprise: acoperire OWASP Top 10, validări înainte de procesare, rate limiting.
- Testare riguroasă: 91 teste backend + 28 teste frontend, acoperire funcțională și de securitate.
- Uptime proiectat: 99.9% prin heartbeat + auto-reconnect și management robust al erorilor.
- Extensibilitate: arhitectură modulară, ușor de adaptat pentru cerințe specifice.

## Arhitectură (pe scurt)
- Backend (FastAPI + WebSockets):
  - Punct de intrare: `escalada/main.py` (CORS, logging).
  - API live: `escalada/api/live.py` (procesare comenzi, broadcast, snapshots).
  - Validare: `escalada/validation.py` (Pydantic v2, validators).
  - Rate limit: `escalada/rate_limit.py` (per box, per comandă).
  - Autentificare: `escalada/auth.py` (JWT, HS256).
- Frontend (React + Vite):
  - Control Panel: `escalada-ui/src/components/ControlPanel.jsx`.
  - Judge Page: `escalada-ui/src/components/JudgePage.jsx`.
  - State: `escalada-ui/src/utilis/useAppState.jsx` + BroadcastChannel.
  - WebSocket: `useWebSocketWithHeartbeat.js` (auto-reconnect, PING/PONG).

## Flux de Comunicare
1. Acțiune utilizator (ex. START_TIMER) → `contestActions.js` → POST `/api/cmd` (include `boxVersion`/`sessionId`).
2. Backend validează → actualizează stare → broadcast via WebSocket.
3. Clienții primesc update → sincronizează starea locală.
4. BroadcastChannel sincronizează între tab-uri de pe același origin.

## Demonstrație / Rulare Locală
```bash
# Backend (port 8000)
cd Escalada
poetry install
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (port 5173, proxy către backend)
cd Escalada/escalada-ui
npm install
npm run dev
```
Acces: Control Panel și Judge Page din browser (localhost:5173), link Judge via QR.

## Securitate & Conformitate
- Validări stricte input (nume competitori, preset timp MM:SS, scoruri, delta progrese).
- Prevenție XSS/SQL injection în validators + sanitizare.
- JWT pentru endpoints protejate.
- Protecție DoS prin rate limiting + blocare temporară.
- Operări atomice cu lock-uri pentru a preveni condiții de cursă.

## Fiabilitate & Testare
- Heartbeat WebSocket cu auto-reconectare.
- Timeouts de recepție pentru conexiuni „mute”.
- 91 teste backend (validări, rate limiting, securitate, heartbeat, snapshots).
- 28 teste frontend (state management, messaging, fluxuri Control Panel).

## Public Țintă & Utilizări
- Cluburi sportive, federații de escaladă, organizatori de evenimente.
- Competiții indoor/outdoor, bouldering, speed, lead (adaptabil).
- Evenimente cu mai multe „box-uri” (trasee) arbitrate în paralel.

## Integrare & Personalizare
- Branding și tematizare UI (Tailwind/Tema custom).
- Export clasamente, ceremonii (winners/podium) și pagini dedicate.
- Config CORS pentru rețele locale sau producție.
- Extensii pentru noi tipuri de comenzi sau raportări.

## Licențiere & Suport
- Licență comercială cu drept de utilizare la evenimente.
- Pachete de suport: Standard (email), Pro (SLA, on-call în ziua evenimentului).
- Opțiuni de găzduire: self-hosted sau cloud gestionat.
- Preț: la cerere, în funcție de numărul de evenimente și opțiunile de suport.

## Roadmap (selectiv)
- Integrare cu rezultate live pe web (public scoreboard).
- Modul multi-rol (operator, arbitru, verificator, prezentator).
- Import automat liste concurenți din fișiere standard.
- Analytics post-eveniment (timp mediu, distribuții scor, etc.).

## Cerințe Tehnice Minimale
- Backend: Python 3.11+, FastAPI, Uvicorn (Poetry).
- Frontend: Node 18+, Vite, React.
- Rețea stabilă pentru conexiuni WebSocket; TLS opțional.

## Termeni & Legal
- Conformitate cu normele de protecție a datelor participanților.
- Jurnale evenimente și mesaje pentru audit.
- Limitări de răspundere standard pentru software de eveniment.

## Contact
Pentru demonstrații, ofertare sau întrebări tehnice:
- Email: sales@escalada.app
- Telefon: +40 7XX XXX XXX
- Website: https://escalada.app (demo la cerere)
