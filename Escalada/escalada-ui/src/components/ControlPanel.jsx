// API constants for ControlPanel direct fetches (WS broadcast)
const API_PROTOCOL_CP = window.location.protocol === 'https:' ? 'https' : 'http';
const API_CP = `${API_PROTOCOL_CP}://${window.location.hostname}:8000/api/cmd`;
// Map boxId -> reference to the opened contest tab
const openTabs = {};
import QRCode from 'react-qr-code';
import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import ModalUpload from "./ModalUpload";
import ModalTimer from "./ModalTimer";
import { startTimer, updateProgress, requestActiveCompetitor, submitScore, initRoute } from '../utilis/contestActions';
import ModalModifyScore from "./ModalModifyScore";
import getWinners from '../utilis/getWinners';

const isTabAlive = (t) => {
  try {
    return t && !t.closed;
  } catch {
    return false;         
  }
};
const ModalScore = lazy(() => import("./ModalScore"));
const ControlPanel = () => {
  // Ignoră WS close noise la demontare
window.addEventListener("error", (e) => {
  if (e.message?.includes("WebSocket") && e.message?.includes("closed")) {
    e.preventDefault();
  }
});
  const [showModal, setShowModal] = useState(false);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [controlTimers, setControlTimers] = useState({});
  const [listboxes, setListboxes] = useState(() => {
    const saved = localStorage.getItem("listboxes");
    return saved ? JSON.parse(saved) : [];
  });
  const [climbingTime, setClimbingTime] = useState("");
  const [startedTabs, setStartedTabs] = useState({});
  const [activeBoxId, setActiveBoxId] = useState(null);
  const [activeCompetitor, setActiveCompetitor] = useState("");
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [editList, setEditList] = useState([]);
  const [editScores, setEditScores] = useState({});
  const [currentClimbers, setCurrentClimbers] = useState({});
  const [holdClicks, setHoldClicks] = useState({});
  const [usedHalfHold, setUsedHalfHold] = useState({});


  // Refs pentru a păstra ultima versiune a stărilor
  const listboxesRef = useRef(listboxes);
  const currentClimbersRef = useRef(currentClimbers);
  const startedTabsRef = useRef(startedTabs);
  const holdClicksRef = useRef(holdClicks);

  // Menține ref-urile actualizate la fiecare schimbare de stare
  useEffect(() => {
    listboxesRef.current = listboxes;
  }, [listboxes]);

  useEffect(() => {
    currentClimbersRef.current = currentClimbers;
  }, [currentClimbers]);

  useEffect(() => {
    startedTabsRef.current = startedTabs;
  }, [startedTabs]);

  useEffect(() => {
    holdClicksRef.current = holdClicks;
  }, [holdClicks]);
  
  
  // WebSocket: subscribe to each box channel and mirror updates from JudgePage
  const wsRefs = useRef({});
  useEffect(() => {
    listboxes.forEach((lb, idx) => {
      // dacă deja avem WS pentru acest idx, nu mai deschide altul
      if (!wsRefs.current[idx] || wsRefs.current[idx].readyState === WebSocket.CLOSED) {
        const ws = new WebSocket(`ws://${window.location.hostname}:8000/api/ws/${idx}`);
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          console.log("📥 WS mesaj primit în ControlPanel:", msg);
          if (+msg.boxId !== idx) return;

          switch (msg.type) {
            case 'START_TIMER':
              setStartedTabs(prev => {
                const updated = { ...prev, [idx]: true };
                console.log("Actualizare startedTabs:", updated);
                return updated;
              });
              break;
            case 'PROGRESS_UPDATE':
              setHoldClicks(prev => {
                const curr = prev[idx] || 0;
                const next = msg.delta === 1
                  ? Math.floor(curr) + 1
                  : Number((curr + msg.delta).toFixed(1));
                return { ...prev, [idx]: next };
              });
              setUsedHalfHold(prev => ({ ...prev, [idx]: msg.delta === 0.1 }));
              break;
            case 'SUBMIT_SCORE':
              setHoldClicks(prev => ({ ...prev, [idx]: 0 }));
              setUsedHalfHold(prev => ({ ...prev, [idx]: false }));
              setStartedTabs(prev => ({ ...prev, [idx]: false }));
              break;
            case 'REQUEST_STATE':
              const box = listboxesRef.current[idx] || {};
              (async () => {
                const snapshot = {
                  boxId: idx,
                  type: 'STATE_SNAPSHOT',
                  initiated: !!box.initiated,
                  holdsCount: box.holdsCount ?? 0,
                  currentClimber: currentClimbersRef.current[idx] ?? '',
                  started: !!startedTabsRef.current[idx],
                  holdCount: holdClicksRef.current[idx] ?? 0
                };
                wsRefs.current[idx].send(JSON.stringify(snapshot));
                })();
                break;
            default:
              break;
          }
        };
        wsRefs.current[idx] = ws;
      }
    });
    return () => {
      Object.values(wsRefs.current).forEach(ws => ws.close());
    };
  }, [listboxes]);

  // Format seconds into "mm:ss"
  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // convert preset MM:SS în secunde
  const defaultTimerSec = (() => {
      const t = localStorage.getItem("climbingTime") || climbingTime || "05:00";
      const [m, s] = t.split(":").map(Number);
      return m * 60 + s;
    })();

    
  
  useEffect(() => {
    // Inițializare timere din localStorage la încărcare pagină
    const initial = {};
    listboxes.forEach((_, idx) => {
      const v = localStorage.getItem(`timer-${idx}`);
      if (v != null) initial[idx] = parseInt(v);
    });
    setControlTimers(initial);
  
    // Ascultă evenimentul 'storage' pentru sincronizare
    const handleStorage = (e) => {
      if (e.key?.startsWith('timer-')) {
        const boxId = parseInt(e.key.split('-')[1]);
        const remaining = parseInt(e.newValue);
        setControlTimers(prev => ({
          ...prev,
          [boxId]: remaining
        }));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [listboxes]);

  useEffect(() => {
    const handleStorageClimber = (e) => {
      if (e.key?.startsWith("currentClimber-")) {
        const idx = Number(e.key.split("-")[1]);
        setCurrentClimbers(prev => ({
          ...prev,
          [idx]: e.newValue
        }));
        // broadcast to WS listeners
        fetch(API_CP, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            boxId: idx,
            type: 'ACTIVE_CLIMBER',
            competitor: e.newValue
          })
        });
      }
    };
    window.addEventListener("storage", handleStorageClimber);
    return () => window.removeEventListener("storage", handleStorageClimber);
  }, []);


  useEffect(() => {
    localStorage.setItem("listboxes", JSON.stringify(listboxes));
  }, [listboxes]);

  useEffect(() => {
    const onListboxChange = (e) => {
      if (e.key === 'listboxes') {
        try {
          const updated = JSON.parse(e.newValue || '[]');
          setListboxes(updated);
        } catch {}
      }
    };
    window.addEventListener('storage', onListboxChange);
    return () => window.removeEventListener('storage', onListboxChange);
  }, []);
  
  useEffect(() => {
    const handleMessage = (e) => {
      if (e.key === "climb_response") {
        try {
          const parsed = JSON.parse(e.newValue);
          if (
            parsed.type === "RESPONSE_ACTIVE_COMPETITOR" &&
            parsed.boxId === activeBoxId ) {
            setActiveCompetitor(parsed.competitor);
            setShowScoreModal(true);
          }
        } catch (error) {
          console.error("Eroare la parsarea datelor:", error);
        }
      }
    };
    window.addEventListener("storage", handleMessage);
    return () => window.removeEventListener("storage", handleMessage);
  }, [activeBoxId]);

  const handleUpload = (data) => {
    const { categorie, concurenti, routesCount, holdsCounts } = data;
    const newIdx = listboxes.length;
    setListboxes(prev => [
      ...prev,
      {
        categorie,
        concurenti,
        holdsCounts,
        routesCount,
        routeIndex: 1,
        holdsCount: holdsCounts[0],
        initiated: false
      }
    ]);
    // initialize counters for the new box
    setHoldClicks(prev => ({ ...prev, [newIdx]: 0 }));
    setUsedHalfHold(prev => ({ ...prev, [newIdx]: false }));
    setStartedTabs(prev => ({ ...prev, [newIdx]: false }));
  };

  const handleDelete = (index) => {
    // Optional: clean up tab reference when deleted
    if (openTabs[index] && !openTabs[index].closed) {
      openTabs[index].close();
    }
    delete openTabs[index];
    setListboxes((prev) => prev.filter((_, i) => i !== index));
    // remove counters for deleted box
    setHoldClicks(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
    setUsedHalfHold(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
    setStartedTabs(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
    // remove current climber for deleted box
    setCurrentClimbers(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
  };


  // Reset listbox to its initial state
  const handleReset = (index) => {
    setListboxes(prev =>
      prev
        .map((lb, i) => {
          if (i !== index) return lb;
          return {
            ...lb,
            initiated: false,
            routeIndex: 1,
            holdsCount: lb.holdsCounts[0],
            concurenti: lb.concurenti.map(c => ({ ...c, marked: false })),
          };
        })
        // caz special: dacă există un listbox “următor” în aceeași categorie, îl eliminăm
        .filter((lb, i) => i === index || lb.categorie !== listboxes[index].categorie)
    );
    // închide tab-ul dacă era deschis
    const tab = openTabs[index];
    if (tab && !tab.closed) tab.close();
    delete openTabs[index];
    // reset local state for holds and timer
    setHoldClicks(prev => ({ ...prev, [index]: 0 }));
    setUsedHalfHold(prev => ({ ...prev, [index]: false }));
    setStartedTabs(prev => ({ ...prev, [index]: false }));
    // reset current climber highlight
    setCurrentClimbers(prev => ({ ...prev, [index]: '' }));
  };

  const handleInitiate = (index) => {
    // 1. Marchează listbox‑ul ca inițiat
    setListboxes(prev =>
      prev.map((lb, i) => i === index ? { ...lb, initiated: true } : lb)
    );
    setStartedTabs(prev => ({ ...prev, [index]: false }));
    // 2. Dacă tab‑ul nu există sau s‑a închis → deschide
    let tab = openTabs[index];
    if (!isTabAlive(tab)) {
      const url = `${window.location.origin}/#/contest/${index}`;
      tab = window.open(url, "_blank");
      if (tab) openTabs[index] = tab;
    } else {
      // tab există: adu‑l în față
      tab.focus();
    }

    // 3. Trimite mesaj de (re)inițiere pentru traseul curent prin HTTP+WS
    if (tab && !tab.closed) {
      const lb = listboxes[index];
      // send INIT_ROUTE via HTTP+WS
      initRoute(index, lb.routeIndex, lb.holdsCount, lb.concurenti);
    }
  };
 
  // Advance to the next route on demand
  const handleNextRoute = (index) => {
    setListboxes(prev =>
      prev.map((lb, i) => {
        if (i !== index) return lb;
        const next = lb.routeIndex + 1;
        if (next > lb.routesCount) return lb;  // nu depășește
        return {
          ...lb,
          routeIndex: next,
          holdsCount: lb.holdsCounts[next - 1],
          initiated: false,
          concurenti: lb.concurenti.map(c => ({ ...c, marked: false })),
        };
      })
    );
    // resetează contorul local de holds
    setHoldClicks(prev => ({ ...prev, [index]: 0 }));
    // reset timer button
    setStartedTabs(prev => ({ ...prev, [index]: false }));
    // Send INIT_ROUTE for the next route
    const currentBox = listboxes[index];
    const nextRouteIndex = currentBox.routeIndex + 1;
    if (nextRouteIndex <= currentBox.routesCount) {
      const nextHoldsCount = currentBox.holdsCounts[nextRouteIndex - 1];
      const nextCompetitors = currentBox.concurenti.map(c => ({ ...c, marked: false }));
      initRoute(index, nextRouteIndex, nextHoldsCount, nextCompetitors);
    }
  };
  // --- handlere globale pentru butoane optimiste ------------------
  const handleClickStart = async (boxIdx) => {
    // Deblocare imediată UI
    setStartedTabs(prev => ({ ...prev, [boxIdx]: true }));
    try {
      await startTimer(boxIdx);
    } catch (err) {
      console.error("START_TIMER failed:", err);
      setStartedTabs(prev => ({ ...prev, [boxIdx]: false }));
    }
  };

  const handleClickHold = async (boxIdx) => {
    try {
      await updateProgress(boxIdx, 1);
    } catch (err) {
      console.error("PROGRESS_UPDATE failed:", err);
    }
  };

  const handleHalfHoldClick = async (boxIdx) => {
    try {
      await updateProgress(boxIdx, 0.1);
    } catch (err) {
      console.error("PROGRESS_UPDATE 0.1 failed:", err);
    }
  };

  const handleScoreSubmit = async (score, boxIdx) => {
    await submitScore(boxIdx, score, activeCompetitor);
    // Reset UI state for this box
    setHoldClicks(prev => ({ ...prev, [boxIdx]: 0 }));
    setUsedHalfHold(prev => ({ ...prev, [boxIdx]: false }));
    setStartedTabs(prev => ({ ...prev, [boxIdx]: false }));
    setShowScoreModal(false);
    setActiveBoxId(null);
  };

  const buildEditLists = (boxIdx) => {
    const comp = [];
    const scores = {};
    const box = listboxes[boxIdx];
    if (box && box.concurenti) {
      box.concurenti.forEach(c => {
        if (c.marked) comp.push(c.nume);
      });
    }
    return { comp, scores };
  };
  const handleCeremony = (category) => {
    // Open the ceremony window immediately on click
    const win = window.open(
      '/ceremony.html',
      '_blank',
      'width=1920,height=1080'
    );
    if (!win) {
      alert('Browserul a blocat fereastra – activează pop-up-uri pentru acest site.');
      return;
    }

    // Fetch podium from backend
    getWinners(boxIdx)
      .then(winners => {
        win.ceremonyWinners = winners;
      })
      .catch(err => {
        console.error('Error fetching podium:', err);
        alert('Nu am putut obține podium-ul de la server.');
        win.close();
      });
  };

  return (
    <div className="p-6">
      <div className="w-full max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-center mb-6">Control Panel</h1>
        <div className="flex gap-2 justify-center mb-4">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => setShowModal(true)}
          >
            Open Listbox
        </button>
        <button
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            onClick={() => setShowTimerModal(true)}
        >
            Set Timer
        </button>
        </div>

        <ModalUpload
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onUpload={handleUpload}
        />
        <ModalTimer
            isOpen={showTimerModal}
            onClose={() => setShowTimerModal(false)}
            onSet={(time) => {
                localStorage.setItem("climbingTime", time);
                setClimbingTime(time);
            }}
            />
        
      </div>

      <div className="mt-6 flex flex-nowrap gap-4 overflow-x-auto">
        {listboxes.map((lb, idx) => {
          const judgeUrl = `${window.location.origin}/#/judge/${idx}`;
          return (
  <details
    key={idx}
    open
    className="relative border border-gray-300 rounded bg-white shadow w-64"
  >
    <summary className="flex justify-between items-center text-lg font-semibold cursor-pointer p-2 bg-gray-100">
      <span>
        {lb.categorie} – Traseu {lb.routeIndex}/{lb.routesCount}
      </span>

      {/* timer display */}
      <div className="px-2 py-1 text-right text-sm text-gray-600">
        {typeof controlTimers[idx] === 'number'
          ? formatTime(controlTimers[idx])
          : formatTime(defaultTimerSec)}
      </div>
    </summary>

    <ul className="list-disc pl-5 p-2 bg-blue-900 text-white rounded">
      {lb.concurenti.map((c, i) => {
        const isClimbing = currentClimbers[idx] === c.nume;
        return (
          <li
            key={i}
            className={`
              ${c.marked ? "marked-red " : ""}
              ${isClimbing ? "bg-yellow-500 text-white animate-pulse " : ""}
              py-1 px-2 rounded
            `}
          >
            {c.nume} – {c.club}
          </li>
        );
      })}
    </ul>
        <div className="mt-2 flex flex-col gap-2">
        {!lb.initiated && (
          <button
            className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50"
            onClick={() => handleInitiate(idx)}
            disabled={lb.initiated}
          >
            Initiate Contest
          </button>
        )}
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
            onClick={() => handleClickStart(idx)}
            disabled={!lb.initiated || startedTabs[idx]}
          >
            Start Time
          </button>
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              <button
                className="px-12 py-3 bg-purple-600 text-white rounded hover:bg-purple-700 active:scale-95 transition flex flex-col items-center disabled:opacity-50"
                onClick={() => handleClickHold(idx)}
                disabled={!lb.initiated || !startedTabs[idx]}
              >
                <div className="flex flex-col items-center">
                  <span className="text-xs font-medium">{currentClimbers[idx] || ""}</span>
                  <span>+1 Hold</span>
                  <span className="text-sm">Score {holdClicks[idx] || 0} → {lb.holdsCount}</span>
                </div>
              </button>
              <button
                className="px-4 py-3 bg-purple-600 text-white rounded hover:bg-purple-700 active:scale-95 transition disabled:opacity-50"
                onClick={() => handleHalfHoldClick(idx)}
                disabled={!lb.initiated || !startedTabs[idx] || usedHalfHold[idx]}
              >
                + .1
              </button>
            </div>
          </div>

          <button
            className="px-3 py-1 bg-yellow-500 text-white rounded disabled:opacity-50"
            onClick={() => {
              setActiveBoxId(idx);
              requestActiveCompetitor(idx);
            }}
            disabled={!lb.initiated || !currentClimbers[idx]}
          >
            Insert Score
          </button>


          <Suspense fallback={null}>
            <ModalScore
              isOpen={showScoreModal && activeBoxId === idx}
              competitor={activeCompetitor}
              initialScore={holdClicks[idx] || 0}
              maxScore={lb.holdsCount}
              onClose={() => setShowScoreModal(false)}
              onSubmit={(score) => handleScoreSubmit(score, idx)}
            />
          </Suspense>

          <button
            className="px-3 py-1 bg-green-600 text-white rounded mt-2 disabled:opacity-50"
            onClick={() => {
              const { comp, scores } = buildEditLists(idx);
              setEditList(comp);
              setEditScores(scores);
              setShowModifyModal(true);
            }}
            disabled={lb.concurenti.filter(c => c.marked).length === 0}
          >
            Modify score
          </button>
          <ModalModifyScore
            isOpen={showModifyModal && editList.length > 0}
            competitors={editList}
            scores={editScores}
            onClose={() => setShowModifyModal(false)}
            onSubmit={(name, newScore) => {
              submitScore(idx, newScore, name);
              setShowModifyModal(false);
            }}
          />

          <button
            className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50"
            onClick={() => handleNextRoute(idx)}
            disabled={!lb.concurenti.every(c => c.marked)}
          >
            Next Route
          </button>

          <button
            className="px-3 py-1 bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50"
            onClick={() => {
              // Deschide ruta de arbitri într-o fereastră nouă
              const url = `${window.location.origin}/#/judge/${idx}`;
              window.open(url, "_blank");
            }}
            disabled={!lb.initiated}
          >
            Open Judge View
          </button>
          <div className="mt-2 flex flex-col items-center">
            <span className="text-sm">Judge link</span>
            <QRCode value={judgeUrl} size={96} />
          </div>

          <div className="flex gap-2">
          <button
            className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
            onClick={() => handleReset(idx)}
          >
            Reset Listbox
          </button>
          <button
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            onClick={() => handleDelete(idx)}
          >
            Delete Listbox
          </button>
        </div>
        <button
          className="mt-2 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
          onClick={() => handleCeremony(lb.categorie)}
        >
          Award Ceremony
        </button>
        </div>
      
  </details>
        );
        })}
      </div>
    </div>
  );
};

export default ControlPanel;

// Remove any duplicate declarations of handleScoreSubmit in this file.
  // --- CEREMONY handler ---
  const handleCeremony = (index) => {
    // Deschide tab pentru ceremonia de premiere
    let win = openTabs['ceremony'];
    if (!isTabAlive(win)) {
      win = window.open('/ceremony.html', '_blank');
      if (win) openTabs['ceremony'] = win;
    } else {
      win.focus();
    }
    // Fetch winners for the category
    const lb = listboxes[index];
    getWinners(lb.categorie)
      .then(winners => {
        win.ceremonyWinners = winners;
        // Notify ceremony page via postMessage to trigger init()
        win.postMessage({ winners }, '*');
      })
      .catch(err => {
        alert('Unable to fetch podium: ' + err.message);
      });
  };