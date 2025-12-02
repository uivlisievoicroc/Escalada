// API constants for ControlPanel direct fetches (WS broadcast)
const API_PROTOCOL_CP = window.location.protocol === 'https:' ? 'https' : 'http';
const API_CP = `${API_PROTOCOL_CP}://${window.location.hostname}:8000/api/cmd`;
// Map boxId -> reference to the opened contest tab
const openTabs = {};
import QRCode from 'react-qr-code';
import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import ModalUpload from "./ModalUpload";
import ModalTimer from "./ModalTimer";
import { startTimer, stopTimer, resumeTimer, updateProgress, requestActiveCompetitor, submitScore, initRoute, registerTime } from '../utilis/contestActions';
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
  const loadListboxes = () => {
    const saved = localStorage.getItem("listboxes");
    const globalPreset = localStorage.getItem("climbingTime") || "05:00";
    if (!saved) return [];
    try {
      return JSON.parse(saved).map(lb => ({
        ...lb,
        timerPreset: lb.timerPreset || globalPreset,
      }));
    } catch {
      return [];
    }
  };
  const [listboxes, setListboxes] = useState(loadListboxes);
  const [climbingTime, setClimbingTime] = useState(() => localStorage.getItem("climbingTime") || "05:00");
  const [timeCriterionEnabled, setTimeCriterionEnabled] = useState(() => localStorage.getItem("timeCriterionEnabled") === "on");
  const [timerStates, setTimerStates] = useState({});
  const [activeBoxId, setActiveBoxId] = useState(null);
  const [activeCompetitor, setActiveCompetitor] = useState("");
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [editList, setEditList] = useState([]);
  const [editScores, setEditScores] = useState({});
  const [editTimes, setEditTimes] = useState({});
  const [currentClimbers, setCurrentClimbers] = useState({});
  const [holdClicks, setHoldClicks] = useState({});
  const [usedHalfHold, setUsedHalfHold] = useState({});
  const [registeredTimes, setRegisteredTimes] = useState({});
  const registeredTimesRef = useRef(registeredTimes);
  useEffect(() => {
    registeredTimesRef.current = registeredTimes;
  }, [registeredTimes]);
  const [rankingStatus, setRankingStatus] = useState({});


  // Refs pentru a păstra ultima versiune a stărilor
  const listboxesRef = useRef(listboxes);
  const currentClimbersRef = useRef(currentClimbers);
  const timerStatesRef = useRef(timerStates);
  const holdClicksRef = useRef(holdClicks);

  // Menține ref-urile actualizate la fiecare schimbare de stare
  useEffect(() => {
    listboxesRef.current = listboxes;
  }, [listboxes]);

  useEffect(() => {
    currentClimbersRef.current = currentClimbers;
  }, [currentClimbers]);

  useEffect(() => {
    timerStatesRef.current = timerStates;
  }, [timerStates]);

  useEffect(() => {
    holdClicksRef.current = holdClicks;
  }, [holdClicks]);
  
  
  // WebSocket: subscribe to each box channel and mirror updates from JudgePage
  const wsRefs = useRef({});
  const syncTimeCriterion = (enabled) => {
    setTimeCriterionEnabled(enabled);
    localStorage.setItem("timeCriterionEnabled", enabled ? "on" : "off");
  };
  const propagateTimeCriterion = async (enabled) => {
    syncTimeCriterion(enabled);
    try {
      await fetch(API_CP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId: -1, type: 'SET_TIME_CRITERION', timeCriterionEnabled: enabled })
      });
    } catch (err) {
      console.error("Failed to propagate time criterion toggle", err);
    }
  };
  const handleToggleTimeCriterion = () => {
    propagateTimeCriterion(!timeCriterionEnabled);
  };
  // Align backend/global flag with the locally remembered toggle on first load
  useEffect(() => {
    propagateTimeCriterion(timeCriterionEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const refsSnapshot = wsRefs.current;
    listboxes.forEach((lb, idx) => {
      // dacă deja avem WS pentru acest idx, nu mai deschide altul
      if (!wsRefs.current[idx] || wsRefs.current[idx].readyState === WebSocket.CLOSED) {
        const ws = new WebSocket(`ws://${window.location.hostname}:8000/api/ws/${idx}`);
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'TIME_CRITERION') {
            syncTimeCriterion(!!msg.timeCriterionEnabled);
            return;
          }
          console.log("📥 WS mesaj primit în ControlPanel:", msg);
          if (+msg.boxId !== idx) return;

          switch (msg.type) {
            case 'START_TIMER':
              setTimerStates(prev => ({ ...prev, [idx]: "running" }));
              break;
            case 'STOP_TIMER':
              setTimerStates(prev => ({ ...prev, [idx]: "paused" }));
              break;
            case 'RESUME_TIMER':
              setTimerStates(prev => ({ ...prev, [idx]: "running" }));
              break;
            case 'TIMER_SYNC':
              if (typeof msg.remaining === "number") {
                setControlTimers(prev => ({ ...prev, [idx]: msg.remaining }));
              }
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
              persistRankingEntry(idx, msg.competitor, msg.score, msg.registeredTime);
              setHoldClicks(prev => ({ ...prev, [idx]: 0 }));
              setUsedHalfHold(prev => ({ ...prev, [idx]: false }));
              setTimerStates(prev => ({ ...prev, [idx]: "idle" }));
              clearRegisteredTime(idx);
              break;
            case 'REGISTER_TIME':
              if (typeof msg.registeredTime === "number") {
                setRegisteredTimes(prev => ({ ...prev, [idx]: msg.registeredTime }));
              }
              break;
            case 'REQUEST_STATE':
              {
                const box = listboxesRef.current[idx] || {};
                (async () => {
                  const snapshot = {
                    boxId: idx,
                    type: 'STATE_SNAPSHOT',
                    initiated: !!box.initiated,
                    holdsCount: box.holdsCount ?? 0,
                    currentClimber: currentClimbersRef.current[idx] ?? '',
                    started: timerStatesRef.current[idx] === "running",
                    timerState: timerStatesRef.current[idx] || "idle",
                    holdCount: holdClicksRef.current[idx] ?? 0,
                    registeredTime: registeredTimesRef.current[idx],
                  };
                  wsRefs.current[idx].send(JSON.stringify(snapshot));
                })();
              }
              break;
            case 'STATE_SNAPSHOT':
              setTimerStates(prev => ({ ...prev, [idx]: msg.timerState || (msg.started ? "running" : "idle") }));
              if (typeof msg.holdCount === "number") {
                setHoldClicks(prev => ({ ...prev, [idx]: msg.holdCount }));
              }
              if (typeof msg.currentClimber === "string") {
                setCurrentClimbers(prev => ({ ...prev, [idx]: msg.currentClimber }));
              }
              if (typeof msg.registeredTime === "number") {
                setRegisteredTimes(prev => ({ ...prev, [idx]: msg.registeredTime }));
              }
              if (typeof msg.remaining === "number") {
                setControlTimers(prev => ({ ...prev, [idx]: msg.remaining }));
              }
              if (typeof msg.timeCriterionEnabled === "boolean") {
                syncTimeCriterion(msg.timeCriterionEnabled);
              }
              break;
            default:
              break;
          }
        };
        wsRefs.current[idx] = ws;
      }
    });
    return () => {
      Object.values(refsSnapshot).forEach(ws => ws.close());
    };
  }, [listboxes]);
  // Ascultă sincronizarea timerelor via localStorage (evenimentul 'storage')
  useEffect(() => {
    // BroadcastChannel pentru comenzi timer (START/STOP/RESUME) din alte ferestre
    let bcCmd;
    const handleTimerCmd = (cmd) => {
      if (!cmd || typeof cmd.boxId !== "number") return;
      if (cmd.type === "START_TIMER") setTimerStates(prev => ({ ...prev, [cmd.boxId]: "running" }));
      if (cmd.type === "STOP_TIMER") setTimerStates(prev => ({ ...prev, [cmd.boxId]: "paused" }));
      if (cmd.type === "RESUME_TIMER") setTimerStates(prev => ({ ...prev, [cmd.boxId]: "running" }));
    };
    if ("BroadcastChannel" in window) {
      bcCmd = new BroadcastChannel("timer-cmd");
      bcCmd.onmessage = (ev) => handleTimerCmd(ev.data);
    }
    const onStorageCmd = (e) => {
      if (e.key !== "timer-cmd" || !e.newValue) return;
      try {
        const cmd = JSON.parse(e.newValue);
        handleTimerCmd(cmd);
      } catch (err) {
        console.error("Failed to parse timer-cmd from storage", err);
      }
    };
    window.addEventListener("storage", onStorageCmd);
    // BroadcastChannel (preferat)
    let bc;
    if ("BroadcastChannel" in window) {
      bc = new BroadcastChannel("escalada-timer");
      bc.onmessage = (ev) => {
        const { boxId, remaining } = ev.data || {};
        if (typeof boxId === "number" && typeof remaining === "number") {
          setControlTimers(prev => ({ ...prev, [boxId]: remaining }));
          if (remaining <= 0) {
            setTimerStates(prev => ({ ...prev, [boxId]: "idle" }));
          }
        }
      };
    }
    const onStorageTimer = (e) => {
      if (!e.key || !e.key.startsWith("timer-sync-") || !e.newValue) return;
      try {
        const { boxId, remaining } = JSON.parse(e.newValue);
        if (typeof boxId === "number" && typeof remaining === "number") {
          setControlTimers(prev => ({ ...prev, [boxId]: remaining }));
          if (remaining <= 0) {
            setTimerStates(prev => ({ ...prev, [boxId]: "idle" }));
          }
        }
      } catch (err) {
        console.error("Failed to parse timer-sync", err);
      }
    };
    window.addEventListener("storage", onStorageTimer);
    return () => {
      window.removeEventListener("storage", onStorageTimer);
      window.removeEventListener("storage", onStorageCmd);
      if (bcCmd) bcCmd.close();
      if (bc) bc.close();
    };
  }, []);

  // Format seconds into "mm:ss"
  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const getTimerPreset = (idx) => {
    const stored = localStorage.getItem(`climbingTime-${idx}`);
    const lb = listboxesRef.current[idx] || listboxes[idx];
    const fallback = localStorage.getItem("climbingTime") || climbingTime || "05:00";
    return stored || (lb && lb.timerPreset) || fallback;
  };

  // convert preset MM:SS în secunde pentru un box
  const defaultTimerSec = (idx) => {
      const t = getTimerPreset(idx);
      const [m, s] = t.split(":").map(Number);
      return (m || 0) * 60 + (s || 0);
    };

  const readCurrentTimerSec = (idx) => {
    if (typeof controlTimers[idx] === "number") return controlTimers[idx];
    const raw = localStorage.getItem(`timer-${idx}`);
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const clearRegisteredTime = (idx) => {
    setRegisteredTimes(prev => {
      const { [idx]: _, ...rest } = prev;
      return rest;
    });
    try {
      localStorage.removeItem(`registeredTime-${idx}`);
    } catch (err) {
      console.error("Failed to clear registered time", err);
    }
  };

  const handleRegisterTime = (idx) => {
    if (!timeCriterionEnabled) return;
    const current = readCurrentTimerSec(idx);
    if (current == null) {
      alert("Nu există un timp de înregistrat pentru acest box.");
      return;
    }
    const total = defaultTimerSec(idx);
    const elapsed = Math.max(0, total - current);
    setRegisteredTimes(prev => ({ ...prev, [idx]: elapsed }));
    try {
      localStorage.setItem(`registeredTime-${idx}`, elapsed.toString());
    } catch (err) {
      console.error("Failed to save registered time", err);
    }
    registerTime(idx, elapsed);
  };

    
  
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
    const initial = {};
    listboxes.forEach((_, idx) => {
      const raw = localStorage.getItem(`registeredTime-${idx}`);
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) {
        initial[idx] = parsed;
      }
    });
    setRegisteredTimes(initial);

    const onStorageRegistered = (e) => {
      if (!e.key?.startsWith("registeredTime-")) return;
      const idx = Number(e.key.split("-")[1]);
      const parsed = parseInt(e.newValue, 10);
      setRegisteredTimes(prev => {
        if (Number.isNaN(parsed)) {
          const { [idx]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [idx]: parsed };
      });
    };
    window.addEventListener("storage", onStorageRegistered);
    return () => window.removeEventListener("storage", onStorageRegistered);
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
    localStorage.setItem("timeCriterionEnabled", timeCriterionEnabled ? "on" : "off");
  }, [timeCriterionEnabled]);

  useEffect(() => {
    if (timeCriterionEnabled) return;
    setRegisteredTimes({});
    listboxes.forEach((_, idx) => {
      try {
        localStorage.removeItem(`registeredTime-${idx}`);
      } catch (err) {
        console.error("Failed to clear registered times on toggle off", err);
      }
    });
  }, [timeCriterionEnabled, listboxes]);

  useEffect(() => {
    const onListboxChange = (e) => {
      if (e.key === 'listboxes') {
        try {
          const updated = JSON.parse(e.newValue || '[]');
          setListboxes(updated);
        } catch (err) {
          console.error("Failed to parse listboxes from storage", err);
        }
      }
    };
    window.addEventListener('storage', onListboxChange);
    return () => window.removeEventListener('storage', onListboxChange);
  }, []);

  useEffect(() => {
    const onStorageToggle = (e) => {
      if (e.key === "timeCriterionEnabled") {
        setTimeCriterionEnabled(e.newValue === "on");
      }
    };
    window.addEventListener("storage", onStorageToggle);
    return () => window.removeEventListener("storage", onStorageToggle);
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
    const timerPreset = climbingTime || localStorage.getItem("climbingTime") || "05:00";
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
        initiated: false,
        timerPreset,
      }
    ]);
    localStorage.setItem(`climbingTime-${newIdx}`, timerPreset);
    // initialize counters for the new box
    setHoldClicks(prev => ({ ...prev, [newIdx]: 0 }));
    setUsedHalfHold(prev => ({ ...prev, [newIdx]: false }));
    setTimerStates(prev => ({ ...prev, [newIdx]: "idle" }));
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
    setTimerStates(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
    // remove current climber for deleted box
    setCurrentClimbers(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
    clearRegisteredTime(index);
    try {
      localStorage.removeItem(`ranking-${index}`);
      localStorage.removeItem(`rankingTimes-${index}`);
    } catch (err) {
      console.error("Failed to clear cached rankings on delete", err);
    }
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
    setTimerStates(prev => ({ ...prev, [index]: "idle" }));
    clearRegisteredTime(index);
    // reset current climber highlight
    setCurrentClimbers(prev => ({ ...prev, [index]: '' }));
  };

  const handleInitiate = (index) => {
    // 1. Marchează listbox‑ul ca inițiat
    setListboxes(prev =>
      prev.map((lb, i) => i === index ? { ...lb, initiated: true } : lb)
    );
    setTimerStates(prev => ({ ...prev, [index]: "idle" }));
    clearRegisteredTime(index);
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
      const preset = getTimerPreset(index);
      localStorage.setItem(`climbingTime-${index}`, preset);
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
    setTimerStates(prev => ({ ...prev, [index]: "idle" }));
    clearRegisteredTime(index);
    try {
      localStorage.removeItem(`ranking-${index}`);
      localStorage.removeItem(`rankingTimes-${index}`);
    } catch (err) {
      console.error("Failed to clear cached rankings on reset", err);
    }
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
    setTimerStates(prev => ({ ...prev, [boxIdx]: "running" }));
    clearRegisteredTime(boxIdx);
    try {
      await startTimer(boxIdx);
    } catch (err) {
      console.error("START_TIMER failed:", err);
      setTimerStates(prev => ({ ...prev, [boxIdx]: "idle" }));
    }
  };

  const handleClickStop = async (boxIdx) => {
    setTimerStates(prev => ({ ...prev, [boxIdx]: "paused" }));
    try {
      await stopTimer(boxIdx);
    } catch (err) {
      console.error("STOP_TIMER failed:", err);
      setTimerStates(prev => ({ ...prev, [boxIdx]: "running" }));
    }
  };

  const handleClickResume = async (boxIdx) => {
    setTimerStates(prev => ({ ...prev, [boxIdx]: "running" }));
    clearRegisteredTime(boxIdx);
    try {
      await resumeTimer(boxIdx);
    } catch (err) {
      console.error("RESUME_TIMER failed:", err);
      setTimerStates(prev => ({ ...prev, [boxIdx]: "paused" }));
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

  const persistRankingEntry = (boxIdx, competitor, score, registeredTime) => {
    if (!competitor) return;
    const box = listboxesRef.current[boxIdx] || listboxes[boxIdx];
    const routeIdx = (box?.routeIndex || 1) - 1;
    const timeVal =
      typeof registeredTime === "string"
        ? parseFloat(registeredTime)
        : registeredTime;
    try {
      const rawScores = localStorage.getItem(`ranking-${boxIdx}`);
      const rawTimes = localStorage.getItem(`rankingTimes-${boxIdx}`);
      const scores = rawScores ? JSON.parse(rawScores) : {};
      const times = rawTimes ? JSON.parse(rawTimes) : {};
      if (!scores[competitor]) scores[competitor] = [];
      if (!times[competitor]) times[competitor] = [];
      scores[competitor][routeIdx] = score;
      if (typeof timeVal === "number" && !Number.isNaN(timeVal)) {
        times[competitor][routeIdx] = timeVal;
      }
      localStorage.setItem(`ranking-${boxIdx}`, JSON.stringify(scores));
      localStorage.setItem(`rankingTimes-${boxIdx}`, JSON.stringify(times));
    } catch (err) {
      console.error("Failed to persist ranking entry", err);
    }
  };

  const handleScoreSubmit = async (score, boxIdx) => {
    const registeredTime = (() => {
      if (!timeCriterionEnabled) return undefined;
      const fromState = registeredTimes[boxIdx];
      if (typeof fromState === "number") return fromState;
      const raw = localStorage.getItem(`registeredTime-${boxIdx}`);
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) return parsed;
      // Fallback: calculează automat pe baza timerului curent
      const current = readCurrentTimerSec(boxIdx);
      if (typeof current === "number") {
        const total = defaultTimerSec(boxIdx);
        const elapsed = Math.max(0, total - current);
        // salvează pentru consistență locală
        localStorage.setItem(`registeredTime-${boxIdx}`, elapsed.toString());
        setRegisteredTimes(prev => ({ ...prev, [boxIdx]: elapsed }));
        return elapsed;
      }
      return undefined;
    })();
    persistRankingEntry(boxIdx, activeCompetitor, score, registeredTime);
    await submitScore(boxIdx, score, activeCompetitor, registeredTime);
    // Reset UI state for this box
    setHoldClicks(prev => ({ ...prev, [boxIdx]: 0 }));
    setUsedHalfHold(prev => ({ ...prev, [boxIdx]: false }));
    setTimerStates(prev => ({ ...prev, [boxIdx]: "idle" }));
    setShowScoreModal(false);
    setActiveBoxId(null);
    clearRegisteredTime(boxIdx);
  };

  const buildEditLists = (boxIdx) => {
    const comp = [];
    const scores = {};
    const times = {};
    const box = listboxes[boxIdx];
    const routeIdx = (box?.routeIndex || 1) - 1;
    let cachedScores = {};
    let cachedTimes = {};
    try {
      cachedScores = JSON.parse(localStorage.getItem(`ranking-${boxIdx}`) || "{}");
      cachedTimes = JSON.parse(localStorage.getItem(`rankingTimes-${boxIdx}`) || "{}");
    } catch (err) {
      console.error("Failed to read cached rankings", err);
    }
    if (box && box.concurenti) {
      box.concurenti.forEach(c => {
        if (c.marked) comp.push(c.nume);
        const arrScore = cachedScores[c.nume];
        if (Array.isArray(arrScore) && arrScore.length > routeIdx) {
          scores[c.nume] = arrScore[routeIdx];
        }
        const arrTime = cachedTimes[c.nume];
        if (Array.isArray(arrTime) && arrTime.length > routeIdx) {
          times[c.nume] = arrTime[routeIdx];
        }
      });
    }
    return { comp, scores, times };
  };
  const showRankingStatus = (boxIdx, message, type = "info") => {
    setRankingStatus(prev => ({ ...prev, [boxIdx]: { message, type } }));
    setTimeout(() => {
      setRankingStatus(prev => {
        if (prev[boxIdx]?.message !== message) return prev;
        const { [boxIdx]: _, ...rest } = prev;
        return rest;
      });
    }, 3000);
  };
  const handleGenerateRankings = async (boxIdx) => {
    const box = listboxesRef.current[boxIdx] || listboxes[boxIdx];
    if (!box) return;
    let ranking = {};
    let rankingTimes = {};
    try {
      ranking = JSON.parse(localStorage.getItem(`ranking-${boxIdx}`) || "{}");
      rankingTimes = JSON.parse(localStorage.getItem(`rankingTimes-${boxIdx}`) || "{}");
    } catch (err) {
      console.error("Failed to read cached rankings for export", err);
    }
    const clubMap = {};
    (box.concurenti || []).forEach(c => { clubMap[c.nume] = c.club; });
    try {
      const res = await fetch(`${API_CP.replace("/cmd", "")}/save_ranking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categorie: box.categorie,
          route_count: box.routesCount,
          scores: ranking,
          clubs: clubMap,
          times: rankingTimes,
          use_time_tiebreak: timeCriterionEnabled,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showRankingStatus(boxIdx, "Clasament generat");
    } catch (err) {
      console.error("Eroare la generarea clasamentului:", err);
      showRankingStatus(boxIdx, "Eroare la generare", "error");
    }
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
    getWinners(category)
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
            timeCriterionEnabled={timeCriterionEnabled}
            onToggleTimeCriterion={handleToggleTimeCriterion}
            />
        
      </div>

      <div className="mt-6 flex flex-nowrap gap-4 overflow-x-auto">
        {listboxes.map((lb, idx) => {
          const judgeUrl = `${window.location.origin}/#/judge/${idx}`;
          const timerState = timerStates[idx] || "idle";
          const isRunning = timerState === "running";
          const isPaused = timerState === "paused";
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
          : formatTime(defaultTimerSec(idx))}
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
          {!isRunning && !isPaused && (
            <button
              className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
              onClick={() => handleClickStart(idx)}
              disabled={!lb.initiated}
            >
              Start Time
            </button>
          )}
          {isRunning && (
            <button
              className="px-3 py-1 bg-red-600 text-white rounded disabled:opacity-50"
              onClick={() => handleClickStop(idx)}
              disabled={!lb.initiated}
            >
              Stop Time
            </button>
          )}
          {isPaused && (
            <div className="flex gap-2">
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                onClick={() => handleClickResume(idx)}
                disabled={!lb.initiated}
              >
                Resume Time
              </button>
              <button
                className="px-3 py-1 bg-gray-500 text-white rounded disabled:opacity-50"
                onClick={() => handleRegisterTime(idx)}
                disabled={!lb.initiated || !timeCriterionEnabled}
              >
                Register Time
              </button>
            </div>
          )}
          {isPaused && timeCriterionEnabled && registeredTimes[idx] !== undefined && (
            <div className="text-xs text-gray-700 px-1">Registered: {formatTime(registeredTimes[idx])}</div>
          )}
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              <button
                className="px-12 py-3 bg-purple-600 text-white rounded hover:bg-purple-700 active:scale-95 transition flex flex-col items-center disabled:opacity-50"
                onClick={() => handleClickHold(idx)}
                disabled={!lb.initiated || !isRunning}
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
                disabled={!lb.initiated || !isRunning || usedHalfHold[idx]}
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
              registeredTime={timeCriterionEnabled ? registeredTimes[idx] : undefined}
              onClose={() => setShowScoreModal(false)}
              onSubmit={(score) => handleScoreSubmit(score, idx)}
            />
          </Suspense>

          <button
            className="px-3 py-1 bg-green-600 text-white rounded mt-2 disabled:opacity-50"
            onClick={() => {
              const { comp, scores, times } = buildEditLists(idx);
              setEditList(comp);
              setEditScores(scores);
              setEditTimes(times);
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
            times={editTimes}
            onClose={() => setShowModifyModal(false)}
            onSubmit={(name, newScore, newTime) => {
              persistRankingEntry(idx, name, newScore, newTime);
              submitScore(idx, newScore, name, newTime);
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
        className="mt-2 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={() => handleGenerateRankings(idx)}
      >
        Generate Rankings
      </button>
      {rankingStatus[idx]?.message && (
        <div
          className={`text-sm mt-1 px-2 py-1 rounded ${
            rankingStatus[idx].type === "error" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          }`}
        >
          {rankingStatus[idx].message}
        </div>
      )}
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
