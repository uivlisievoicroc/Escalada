import React, { useEffect, useState, useRef } from 'react';
import { ResizableBox } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { useParams } from 'react-router-dom';
// (WebSocket logic moved into component)

// RouteProgress: continuous 5 golden-ratio segments, alternating tilt
const RouteProgress = ({ holds , current = 0, h = 500, w = 20, tilt = 5 }) => {
  const phi = (6 + Math.sqrt(12)) / 2;
  let rem = h;
  const rawSegs = Array.from({ length: 8 }, () => {
    const s = rem / phi;
    rem -= s;
    return s;
  });
  const sumRaw = rawSegs.reduce((sum, s) => sum + s, 0);
  const scaledSegs = rawSegs.map(s => s * (h / sumRaw));
  const segs = scaledSegs.reverse();
  // build points along the path
  const points = [[0, h]];
  segs.forEach((seg, i) => {
    const angleRad = ((i % 2 === 0 ? tilt : -tilt) * Math.PI) / 180;
    const dx = seg * Math.sin(angleRad);
    const dy = -seg * Math.cos(angleRad);
    const [x, y] = points[points.length - 1];
    points.push([x + dx, y + dy]);
  });
  // compute dot position by length
  const totalLen = segs.reduce((a, b) => a + b, 0);
  const target = (holds > 1 ? current / (holds - 1) : 0) * totalLen;
  let accumulated = 0;
  let dotX = 0, dotY = 0;
  for (let i = 0; i < segs.length; i++) {
    if (accumulated + segs[i] >= target) {
      const frac = (target - accumulated) / segs[i];
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      dotX = x1 + (x2 - x1) * frac;
      dotY = y1 + (y2 - y1) * frac;
      break;
    }
    accumulated += segs[i];
  }
  const pathD = 'M ' + points.map(p => p.join(',')).join(' L ');
  return (
    <svg width={w} height={h} className="block overflow-visible">
      <defs>
        <linearGradient id="progressGradient" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="orange" />
          <stop offset="100%" stopColor="black" />
        </linearGradient>
      </defs>
      <path
        d={pathD}
        fill="none"
        stroke="url(#progressGradient)"
        strokeWidth={w}
        strokeLinecap="round"
      />
      <circle
        cx={dotX}
        cy={dotY}
        r={w * 0.75}
        fill="yellow"
        stroke="white"
        strokeWidth={2}
      />
    </svg>
  );
};

// ===== helpers pentru clasament IFSC =====
/** Returnează { [nume]: [rankPoints…] } şi numărul total de concurenţi */
const calcRankPointsPerRoute = (scoresByName, routeIdx) => {
  const rankPoints = {};
  const nRoutes = routeIdx;           // câte rute am până acum
  let nCompetitors = 0;

  // pentru fiecare rută (0‑based)
  for (let r = 0; r < nRoutes; r++) {
    // colectează scorurile existente
    const list = Object.entries(scoresByName)
      .filter(([, arr]) => arr[r] !== undefined)
      .map(([nume, arr]) => ({ nume, score: arr[r] }));

    // sortează descrescător
    list.sort((a, b) => b.score - a.score);

    // parcurge şi atribuie rank‑ul cu tie‑handling
    let pos = 1;
    for (let i = 0; i < list.length; ) {
      const same = list.filter(x => x.score === list[i].score);
      const first = pos;
      const last = pos + same.length - 1;
      const avgRank = (first + last) / 2;      // media aritmetică
      same.forEach(x => {
        if (!rankPoints[x.nume]) rankPoints[x.nume] = Array(nRoutes).fill(undefined);
        rankPoints[x.nume][r] = avgRank;
      });
      pos += same.length;
      i += same.length;
    }
    nCompetitors = Math.max(nCompetitors, list.length);
  }

  return { rankPoints, nCompetitors };
};

/** Calculează QP = media geometrică (rotunjit 3 zec.) */
const geomMean = (arr, nRoutes, nCompetitors) => {
  // lipsă => loc maxim (nCompetitors + 1)
  const filled = arr.map(v => v ?? nCompetitors + 1);
  if (filled.length < nRoutes) {
    // padding pentru rute lipsă
    while (filled.length < nRoutes) filled.push(nCompetitors + 1);
  }
  const prod = filled.reduce((p, x) => p * x, 1);
  return Number(Math.pow(prod, 1 / nRoutes).toFixed(3));
};

const ContestPage = () => {
  const { boxId } = useParams();
  const getTimerPreset = () => {
    const specific = localStorage.getItem(`climbingTime-${boxId}`);
    const global = localStorage.getItem("climbingTime");
    return specific || global || "05:00";
  };
  // --- WebSocket logic ---
  const wsRef = useRef(null);
    useEffect(() => {
      const ws = new WebSocket(`ws://${window.location.hostname}:8000/api/ws/${boxId}`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        // Handle INIT_ROUTE via WebSocket
        if (msg.type === 'INIT_ROUTE') {
          const { routeIndex, competitors, holdsCount } = msg;
          setRouteIdx(routeIndex);
          setHoldsCount(holdsCount);
          if (competitors?.length) {
            setClimbing(competitors[0].nume);
            setPreparing(competitors.slice(1,2).map(c => c.nume));
            setRemaining(competitors.slice(2).map(c => c.nume));
          } else {
            setClimbing("");
            setPreparing([]);
            setRemaining([]);
          }
          // stop and reset timer
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          setRunning(false);
          setEndTimeMs(null);
          const preset = getTimerPreset();
          const [m, s] = preset.split(":").map(Number);
          setTimerSec((m || 0) * 60 + (s || 0));
          return;
        }
        if (msg.type === 'START_TIMER') {
          window.postMessage({ type: 'START_TIMER', boxId: msg.boxId }, '*');
        }
        if (msg.type === 'PROGRESS_UPDATE') {
          window.postMessage({ type: 'PROGRESS_UPDATE', boxId: msg.boxId, delta: msg.delta }, '*');
        }
        if (msg.type === 'REQUEST_ACTIVE_COMPETITOR') {
          // Respond with the current climber name via localStorage for ControlPanel
          localStorage.setItem(
            'climb_response',
            JSON.stringify({
              type: 'RESPONSE_ACTIVE_COMPETITOR',
              boxId: msg.boxId,
              competitor: climbingRef.current,
              ts: Date.now(),
            })
          );
        }
        if (msg.type === 'SUBMIT_SCORE') {
          window.postMessage(
            { type: 'SUBMIT_SCORE', boxId: msg.boxId, score: msg.score, competitor: msg.competitor },
            '*'
          );
        }
      };
      return () => ws.close();
    }, [boxId]);
  const [preparing, setPreparing] = useState([]);
  
  const [climbing, setClimbing] = useState("");
  const climbingRef = useRef("");
  useEffect(() => { 
    climbingRef.current = climbing; },
     [climbing]);
  
  // Sincronizează competitorul curent în localStorage
  useEffect(() => {
    localStorage.setItem(`currentClimber-${boxId}`, climbing);
  }, [climbing, boxId]);

  const [remaining, setRemaining] = useState([]);
  const [timerSec, setTimerSec] = useState(() => {
    const t = getTimerPreset();
    const [m, s] = t.split(":").map(Number);
    return (m || 0) * 60 + (s || 0);
  });
  const preset = getTimerPreset();
  const [mPreset, sPreset] = preset.split(":").map(Number);
  const totalSec = (mPreset || 0) * 60 + (sPreset || 0);
  const [endTimeMs, setEndTimeMs] = useState(null);
  const rafRef = useRef(null);
  const [ranking, setRanking] = useState(() => ({})); // { nume: [scores…] }
  const rankingRef = useRef(ranking);
  useEffect(() => {
    rankingRef.current = ranking;
  }, [ranking]);
  const [running, setRunning] = useState(false);
  const [category, setCategory] = useState("");
  const [routeIdx, setRouteIdx] = useState(1);
  const [finalized, setFinalized] = useState(false);
  const [holdsCount, setHoldsCount] = useState(0);
  const [currentHold, setCurrentHold] = useState(0);
  const [holdsCountsAll, setHoldsCountsAll] = useState([]);
  const BAR_WIDTH = 20;
  const [barHeight, setBarHeight] = useState(500);

    // ===== T1 START_TIMER =====
    useEffect(() => {  
      const onStartT1 = (e) => {
        if (
          e.data?.type === "START_TIMER" && +e.data.boxId === +boxId
        ) {
          const preset = getTimerPreset();
          const [m, s] = preset.split(":").map(Number);
          const duration = (m || 0) * 60 + (s || 0);
          setTimerSec(duration);
          setEndTimeMs(Date.now() + duration * 1000);
          setRunning(true);
          localStorage.setItem(`tick-owner-${boxId}`, window.name || "tick-owner");
        }
      };
      window.addEventListener("message", onStartT1);
      return () => window.removeEventListener("message", onStartT1);
    }, [boxId]);

    // (INIT_ROUTE via WebSocket handled above; removed old postMessage INIT_ROUTE handler)

    // Handle +1 Hold button updates
    useEffect(() => {
      const onProgressUpdate = (e) => {
        if (e.data?.type === "PROGRESS_UPDATE" && +e.data.boxId === +boxId) {
          const delta = typeof e.data.delta === 'number' ? e.data.delta : 1;
          setCurrentHold(prev => {
            // If we're applying a full hold after a semi-hold, drop fractional part
            if (delta === 1 && prev % 1 !== 0) {
              return Math.min(Math.floor(prev) + 1, holdsCount);
            }
            return Math.min(prev + delta, holdsCount);
          });
        }
      };
      window.addEventListener("message", onProgressUpdate);
      return () => window.removeEventListener("message", onProgressUpdate);
    }, [boxId, holdsCount]);

    // Synchronize commands from JudgePage via localStorage
    useEffect(() => {
      const onStorage = (e) => {
        if (!e.key || !e.newValue) return;
        const msg = JSON.parse(e.newValue);
        if (msg.type === 'START_TIMER' && +msg.boxId === +boxId) {
          window.postMessage({ type: 'START_TIMER', boxId: msg.boxId }, '*');
        }
        if (msg.type === 'PROGRESS_UPDATE' && +msg.boxId === +boxId) {
          window.postMessage({ type: 'PROGRESS_UPDATE', boxId: msg.boxId, delta: msg.delta }, '*');
        }
        if (msg.type === 'REQUEST_ACTIVE_COMPETITOR' && +msg.boxId === +boxId) {
          localStorage.setItem(
            'climb_response',
            JSON.stringify({
              type: 'RESPONSE_ACTIVE_COMPETITOR',
              boxId: +boxId,
              competitor: climbingRef.current,
              ts: Date.now(),
            })
          );
        }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }, [boxId]);
      
    // T1 ticking loop
    useEffect(() => {
      if (!running || endTimeMs == null) return;
      const tick = () => {
        const diff = endTimeMs - Date.now();
        const next = Math.max(0, Math.ceil(diff / 1000));
        setTimerSec(next);
        // opțional, sincronizează și în localStorage
        localStorage.setItem(`timer-${boxId}`, next.toString());
        if (next > 0) {
          const owner = localStorage.getItem(`tick-owner-${boxId}`);
          if (owner === (window.name || "tick-owner")) {
            rafRef.current = requestAnimationFrame(tick);
          }
        } else {
          setRunning(false);
          setEndTimeMs(null);
        }
      };
      // Dacă exista un raf în așteptare, îl anulăm
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      tick();
      return () => cancelAnimationFrame(rafRef.current);
    }, [running, endTimeMs]);
    
  // T1 initialization
      useEffect(() => {
        const all = JSON.parse(localStorage.getItem("listboxes") || "[]");
        const box = all[boxId];
        if (!box) return;
        const list = box.concurenti;
        if (list.length > 0) {
          setClimbing ( list[0].nume );
          setPreparing( list.slice(1,2).map(c=>c.nume) );
          setRemaining( list.slice(2).map(c=>c.nume) );
        }
        setRouteIdx(box.routeIndex || 1);
        setHoldsCount(box.holdsCount);
        setHoldsCountsAll(box.holdsCounts);
      }, [boxId]);

     
      // T1 response
      useEffect(() => {
        const handleRequestT1 = (e) => {
          if (e.key === 'climb_request') {
            const parsed = JSON.parse(e.newValue || '{}');
            if (
              parsed.type === 'REQUEST_ACTIVE_COMPETITOR' &&
              +parsed.boxId === +boxId
            ) {
              localStorage.setItem(
                'climb_response',
                JSON.stringify({
                  type: 'RESPONSE_ACTIVE_COMPETITOR',
                  boxId: +boxId,
                  competitor: climbingRef.current,
                  ts: Date.now(),
                })
              );
            }
          }
        };
        window.addEventListener('storage', handleRequestT1);
        return () => window.removeEventListener('storage', handleRequestT1);
      }, [boxId, climbing]);

    // T1 specific logic
      useEffect(() => {
        const handleMessageT1 = (e) => {
          if (e.data?.type !== "SUBMIT_SCORE" || +e.data.boxId !== +boxId) return;

          const competitorName = e.data.competitor;
          if (!competitorName) return;

          // 1. Update ranking state
          const updatedRanking = (() => {
            // start cu valorile curente
            const copy = { ...rankingRef.current };
            if (!copy[competitorName]) copy[competitorName] = [];
            // setează scorul pe ruta curentă (index 1-based → zero-based)
            copy[competitorName][routeIdx - 1] = e.data.score;
            return copy;
          })();
          // setează în state pentru UI
          setRanking(updatedRanking);
          // reset progress bar after score submission
          setCurrentHold(0);

          // 2. Mark competitor in localStorage
          const before = JSON.parse(localStorage.getItem("listboxes") || "[]");
          const boxBefore = before[boxId];
          const idx = boxBefore.concurenti.findIndex(c => c.nume === competitorName);
          if (idx !== -1) {
            boxBefore.concurenti[idx].marked = true;
            localStorage.setItem("listboxes", JSON.stringify(before));
          }

          // 3. Advance only if modifying the current competitor who just climbed
          if (competitorName === climbingRef.current) {
            // Advance climbers list
            setClimbing(preparing[0] || "");
            setPreparing(prev => {
              const next = remaining[0];
              return prev.slice(1).concat(next !== undefined ? [next] : []);
            });
            setRemaining(prev => prev.slice(1));

            // Reset timer
            if (rafRef.current) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            const preset = getTimerPreset();
            const [m, s] = preset.split(":").map(Number);
            const resetSec = (m || 0) * 60 + (s || 0);
            setTimerSec(resetSec);
            setRunning(false);
            setEndTimeMs(null);
            localStorage.setItem(`timer-${boxId}`, resetSec.toString());

            // 5. Detect end of contest
            const after = JSON.parse(localStorage.getItem("listboxes") || "[]");
            const boxAfter = after[boxId];
            const totalRoutes = Number(boxAfter.routesCount);
            const allMarked = boxAfter.concurenti.every(c => c.marked);
            console.log("End detection:", boxAfter.routeIndex, totalRoutes, allMarked);
            if (boxAfter.routeIndex === totalRoutes && allMarked) {
              setFinalized(true);
              // Salvează top-3 concurenți în localStorage pentru Award Ceremony
              const { rankPoints, nCompetitors } = calcRankPointsPerRoute(rankingRef.current, totalRoutes);
              const rows = Object.keys(rankPoints).map(nume => {
                const rp = rankPoints[nume];
                const raw = rankingRef.current[nume] || [];
                const total = geomMean(rp, totalRoutes, nCompetitors);
                return { nume, rp, raw, total };
              });
              rows.sort((a, b) => a.total - b.total);
              const podium = rows.slice(0, 3).map((c, i) => ({
                name: c.nume,
                color: ['#ffd700', '#c0c0c0', '#cd7f32'][i] // aur, argint, bronz
              }));
              localStorage.setItem(`podium-${boxId}`, JSON.stringify(podium));

              setTimeout(() => {
                // Build club mapping: { nume: club }
                const clubMap = {};
                boxAfter.concurenti.forEach(c => { clubMap[c.nume] = c.club; });
                console.log("📦 Payload trimis la backend (setTimeout):", {
                  categorie: boxAfter.categorie,
                  route_count: totalRoutes,
                  scores: rankingRef.current,
                  clubs: clubMap,
                });

                fetch("http://127.0.0.1:8000/api/save_ranking", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    categorie: boxAfter.categorie,
                    route_count: totalRoutes,
                    scores: updatedRanking,
                    clubs: clubMap,
                  }),
                })
                  .then(r => r.json())
                  .then(data => {
                    console.log("✅ Răspuns de la backend:", data);
                  })
                  .catch(err => {
                    console.error("❌ Eroare la salvarea clasamentului:", err);
                  });
              }, 0); // << înlocuiește requestAnimationFrame cu setTimeout
            }
          }
        };
        window.addEventListener("message", handleMessageT1);
        return () => window.removeEventListener("message", handleMessageT1);
      }, [boxId, climbing, preparing, remaining]);
      
  const rankClass = (rank) => {
    if (!finalized) return "";
    switch (rank) {
      case 1:
        return "bg-gradient-to-r from-yellow-800 via-yellow-350 to-yellow-400 animate-pulse font-extrabold italic text-white";
      case 2:
        return "bg-gray-500 font-bold text-white";
      case 3:
        return "bg-amber-600  text-white";
      default:
        return "";
    }
  };
  return (
    <div className="h-screen grid grid-rows-[auto_1fr] bg-gray-50">
      {/* Header */}
      <header className="row-span-1 bg-white shadow-sm flex items-center justify-center">
        <h1 className="text-4xl font-extrabold">{category}</h1>
      </header>

      
      <div className="row-span-1 grid grid-cols-12 gap-4 p-4">
        {/* Left column: Preparing + Climbing */}
        <div className="col-span-5 flex flex-col gap-4">
          {/* Preparing */}
          <aside className="bg-white rounded-lg shadow-md p-6 flex flex-col">
            <h2 className="text-4xl font-semibold mb-4">Preparing</h2>
            <ul className="space-y-2 flex-1 overflow-y-auto text-4xl">
              {preparing.map((n, i) => (
                <li key={i} className="py-6 px-2 bg-gray-100 rounded">
                  {n}
                </li>
              ))}
            </ul>
          </aside>

          {/* Climbing */}
          <main className="relative bg-gradient-to-br from-blue-700 to-blue-900 rounded-lg shadow-lg p-8 h-[43rem]">
            <span className="text-3xl uppercase tracking-wide text-blue-200 mb-2">Climber</span>
            <h2 className={`text-6xl font-extrabold text-white mb-6 ${timerSec > 0 ? 'animate-pulse' : ''}`}>
              {climbing || '—'}
            </h2>
            {/* Progress ring */}
            <div className="relative w-64 h-64 mt-20 mb-6">
              <svg className="absolute inset-0" viewBox="0 0 100 100">
                <circle
                  className="stroke-yellow-500 stroke-11 fill-transparent"
                  cx="50"
                  cy="50"
                  r="45"
                  strokeDasharray="283"
                  strokeDashoffset={283 - (timerSec / totalSec) * 283}
                  style={{ transition: "stroke-dashoffset 1s linear" }}
                />
              </svg>
              <div
                className={`absolute inset-0 flex items-center justify-center font-mono text-7xl ${
                  timerSec <= 5 ? "text-yellow-300 animate-pulse" : "text-white"
                }`}
              >
                {timerSec > 0
                  ? `${String(Math.floor(timerSec / 60)).padStart(2, "0")}:${String(
                      timerSec % 60
                    ).padStart(2, "0")}`
                  : "STOP!"}
              </div>
            </div>
            {/* Route progress bar at bottom-right, resizable */}
            <div className="absolute bottom-4 right-4">
              <ResizableBox
                width={BAR_WIDTH}
                height={barHeight}
                axis="y"
                resizeHandles={["n"]}
                minConstraints={[BAR_WIDTH, 100]}
                maxConstraints={[BAR_WIDTH, 800]}
                onResizeStop={(e, data) => setBarHeight(data.size.height)}
              >
                <RouteProgress
                  holds={holdsCount}
                  current={currentHold}
                  w={BAR_WIDTH}
                  h={barHeight}
                />
              </ResizableBox>
            </div>
          </main>
        </div>

          {/* Ranking */}
          <aside className="col-span-7 bg-gray-200 rounded-lg shadow-md p-6 flex flex-col h-full min-h-0">
            {/* Head row */}
            <div
              className="grid gap-2 divide-x divide-gray-300 font-semibold border-b border-gray-300 pb-2 mb-2"
              style={{ gridTemplateColumns: `1fr repeat(${routeIdx}, 1fr) 80px` }}
            >
              <span className="px-2">Ranking</span>
              {Array.from({ length: routeIdx }).map((_, i) => (
                <span key={i} className="px-2 text-right">Score(T{i + 1})</span>
              ))}
              <span className="px-2 text-right text-red-500">Total</span>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto">
            {(() => {
              const { rankPoints, nCompetitors } = calcRankPointsPerRoute(ranking, routeIdx);
              const rows = Object.keys(rankPoints).map(nume => {
                const rp = rankPoints[nume];
                const raw = ranking[nume] || [];
                const total = geomMean(rp, routeIdx, nCompetitors);
                return { nume, rp, raw, total };
              });
              rows.sort((a, b) => a.total - b.total);

              // Calculează rank cu tie-handling
              const withRank = [];
              let prevTotal = null, prevRank = 0;
              rows.forEach((row, idx) => {
                const rank = row.total === prevTotal ? prevRank : idx + 1;
                withRank.push({ ...row, rank });
                prevTotal = row.total;
                prevRank = rank;
              });


              return withRank.map(row => (
                <div
                  key={row.nume}
                  className={`grid gap-2 divide-x divide-gray-200 py-2 text-2xl ${rankClass(row.rank)}`}
                  style={{ gridTemplateColumns: `1fr repeat(${routeIdx}, 1fr) 80px` }}
                >
                  <span className="px-2 text-4xl font-semibold">{row.rank}. {row.nume}</span>
                  {Array.from({ length: routeIdx }).map((_, i) => (
                    <span key={i} className="px-2 text-right">
                      {row.raw[i] !== undefined
                        ? (holdsCountsAll[i] && row.raw[i] === Number(holdsCountsAll[i]) ? "Top" : row.raw[i].toFixed(1))
                        : "—"}
                    </span>
                  ))}
                  <span className="px-2 text-right font-mono text-red-500">{row.total.toFixed(3)}</span>
                </div>
              ));
            })()}
            </div>
          </aside>
      </div>
     </div>
  );
};

export default ContestPage;