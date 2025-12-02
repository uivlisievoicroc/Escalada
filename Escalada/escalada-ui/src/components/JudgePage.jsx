import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { startTimer, stopTimer, resumeTimer, updateProgress, submitScore, registerTime } from '../utilis/contestActions';
import ModalScore from './ModalScore';
import ModalModifyScore from './ModalModifyScore';

const JudgePage = () => {
  const API_PROTOCOL = window.location.protocol === 'https:' ? 'https' : 'http';
  const API_BASE = `${API_PROTOCOL}://${window.location.hostname}:8000`;
  const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';

  const { boxId } = useParams();
  const idx = Number(boxId);
  const [initiated, setInitiated] = useState(false);
  const [timerState, setTimerState] = useState("idle");
  const [usedHalfHold, setUsedHalfHold] = useState(false);
  const [currentClimber, setCurrentClimber] = useState("");
  const [holdCount, setHoldCount] = useState(0);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [maxScore, setMaxScore] = useState(0);
  const [registeredTime, setRegisteredTime] = useState(() => {
    const raw = localStorage.getItem(`registeredTime-${idx}`);
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });
  const [timeCriterionEnabled, setTimeCriterionEnabled] = useState(() => localStorage.getItem("timeCriterionEnabled") === "on");
  const [timerSeconds, setTimerSeconds] = useState(() => {
    const raw = localStorage.getItem(`timer-${idx}`);
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });
  // WebSocket subscription to backend for real-time updates
  const wsRef = useRef(null);

  const formatTime = (sec) => {
    if (typeof sec !== "number" || Number.isNaN(sec)) return "—";
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const clearRegisteredTime = React.useCallback(() => {
    setRegisteredTime(null);
    try {
      localStorage.removeItem(`registeredTime-${idx}`);
    } catch (err) {
      console.error("Failed clearing registered time", err);
    }
  }, [idx]);

useEffect(() => {
    // Fetch initial state snapshot (manual reconnection)
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/state/${idx}`);
        if (res.ok) {
          const st = await res.json();
          setInitiated(st.initiated);
          setMaxScore(st.holdsCount);
          setCurrentClimber(st.currentClimber);
          setTimerState(st.timerState || (st.started ? "running" : "idle"));
          setHoldCount(st.holdCount);
          if (typeof st.remaining === "number") {
            setTimerSeconds(st.remaining);
            localStorage.setItem(`timer-${idx}`, st.remaining.toString());
          }
          if (typeof st.timeCriterionEnabled === "boolean") {
            setTimeCriterionEnabled(st.timeCriterionEnabled);
            localStorage.setItem("timeCriterionEnabled", st.timeCriterionEnabled ? "on" : "off");
          }
        }
      } catch (e) {
        console.error("Error fetching initial state:", e);
      }
    })();
    // Build WebSocket URL based on how the page was loaded
    const WS_URL = `${WS_PROTOCOL}://${window.location.hostname}:8000/api/ws/${idx}`;
    const ws = new WebSocket(WS_URL);
    // No ws.send REQUEST_STATE on open anymore
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'TIME_CRITERION') {
        setTimeCriterionEnabled(!!msg.timeCriterionEnabled);
        localStorage.setItem("timeCriterionEnabled", msg.timeCriterionEnabled ? "on" : "off");
        return;
      }
      if (msg.type === 'TIMER_SYNC') {
        if (+msg.boxId !== idx) return;
        if (typeof msg.remaining === "number") {
          setTimerSeconds(msg.remaining);
          localStorage.setItem(`timer-${idx}`, msg.remaining.toString());
        }
        return;
      }
      if (+msg.boxId !== idx) return;
       // --- nou: reacționează la INIT_ROUTE -----------------
      if (msg.type === 'INIT_ROUTE') {
        setInitiated(true);                     // activează butoanele
        setMaxScore(msg.holdsCount || 0);      // scor maxim pentru ruta curentă
        setCurrentClimber(
          Array.isArray(msg.competitors) && msg.competitors.length
            ? msg.competitors[0].nume
            : ''
        );
        setTimerState("idle");
        setUsedHalfHold(false);
        setHoldCount(0);
      }
      if (msg.type === 'START_TIMER') {
        setTimerState("running");
      }
      if (msg.type === 'STOP_TIMER') {
        setTimerState("paused");
      }
      if (msg.type === 'RESUME_TIMER') {
        setTimerState("running");
      }
      if (msg.type === 'PROGRESS_UPDATE') {
        const delta = typeof msg.delta === 'number' ? msg.delta : 1;
        setHoldCount(prev => {
          if (delta === 1) return Math.floor(prev) + 1;
          return Number((prev + delta).toFixed(1));
        });
        if (delta === 0.1) setUsedHalfHold(true);
        else setUsedHalfHold(false);
      }
      if (msg.type === 'SUBMIT_SCORE') {
        // reset state identic ControlPanel
        setTimerState("idle");
        setUsedHalfHold(false);
        setHoldCount(0);
        clearRegisteredTime();
      }
      if (msg.type === 'REGISTER_TIME') {
        if (typeof msg.registeredTime === "number") {
          setRegisteredTime(msg.registeredTime);
        }
      }
      // Handle state snapshot from ControlPanel
      if (msg.type === 'STATE_SNAPSHOT') {
        setInitiated(msg.initiated);
        setMaxScore(msg.holdsCount);
        setCurrentClimber(msg.currentClimber || '');
        setTimerState(msg.timerState || (msg.started ? "running" : "idle"));
        setHoldCount(msg.holdCount || 0);
        if (typeof msg.registeredTime === "number") {
          setRegisteredTime(msg.registeredTime);
        }
        if (typeof msg.remaining === "number") {
          setTimerSeconds(msg.remaining);
          localStorage.setItem(`timer-${idx}`, msg.remaining.toString());
        }
        if (typeof msg.timeCriterionEnabled === "boolean") {
          setTimeCriterionEnabled(msg.timeCriterionEnabled);
          localStorage.setItem("timeCriterionEnabled", msg.timeCriterionEnabled ? "on" : "off");
        }
      }
      // Handle ACTIVE_CLIMBER broadcast
      if (msg.type === 'ACTIVE_CLIMBER') {
        setCurrentClimber(msg.competitor || '');
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [idx, API_BASE, WS_PROTOCOL, clearRegisteredTime]);

  useEffect(() => {
    const syncFromStorage = () => {
      const rawTimer = localStorage.getItem(`timer-${idx}`);
      const parsedTimer = parseInt(rawTimer, 10);
      setTimerSeconds(Number.isNaN(parsedTimer) ? null : parsedTimer);
      const rawReg = localStorage.getItem(`registeredTime-${idx}`);
      const parsedReg = parseInt(rawReg, 10);
      setRegisteredTime(Number.isNaN(parsedReg) ? null : parsedReg);
      setTimeCriterionEnabled(localStorage.getItem("timeCriterionEnabled") === "on");
    };
    syncFromStorage();
    const onStorage = (e) => {
      if (e.key === `timer-${idx}`) {
        const parsed = parseInt(e.newValue, 10);
        setTimerSeconds(Number.isNaN(parsed) ? null : parsed);
      }
      if (e.key === `registeredTime-${idx}`) {
        const parsed = parseInt(e.newValue, 10);
        setRegisteredTime(Number.isNaN(parsed) ? null : parsed);
      }
      if (e.key === "timeCriterionEnabled") {
        setTimeCriterionEnabled(e.newValue === "on");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [idx]);

  useEffect(() => {
    if (!timeCriterionEnabled) {
      clearRegisteredTime();
    }
  }, [timeCriterionEnabled, clearRegisteredTime]);
 
  // Handler for Start Time
  const handleStartTime = () => {
    startTimer(idx);
    setTimerState("running");
    clearRegisteredTime();
  };

  const handleStopTime = () => {
    stopTimer(idx);
    setTimerState("paused");
  };

  const handleResumeTime = () => {
    resumeTimer(idx);
    setTimerState("running");
    clearRegisteredTime();
  };

  // Handler for +1 Hold
  const handleHoldClick = () => {
    updateProgress(idx, 1);
    setUsedHalfHold(false);
  };

  // Handler for +0.1 Hold
  const handleHalfHoldClick = () => {
    updateProgress(idx, 0.1);
    setUsedHalfHold(true);
  };

  const handleRegisterTime = () => {
    if (!timeCriterionEnabled || !isPaused) return;
    const fallback = localStorage.getItem(`timer-${idx}`);
    const fromStorage = parseInt(fallback, 10);
    const current = typeof timerSeconds === "number" ? timerSeconds : fromStorage;
    if (current == null || Number.isNaN(current)) {
      alert("Nu există un timp de înregistrat pentru acest box.");
      return;
    }
    setRegisteredTime(current);
    try {
      localStorage.setItem(`registeredTime-${idx}`, current.toString());
    } catch (err) {
      console.error("Failed storing registered time", err);
    }
    registerTime(idx, current);
  };

  // Handler for Insert Score
  const handleInsertScore = () => {
    setShowScoreModal(true);
  };

  const isRunning = timerState === "running";
  const isPaused = timerState === "paused";

  return (
    <div className="p-20 flex flex-col gap-2">
      {!isRunning && !isPaused && (
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={handleStartTime}
          disabled={!initiated}
        >
          Start Time
        </button>
      )}
      {isRunning && (
        <button
          className="px-3 py-1 bg-red-600 text-white rounded disabled:opacity-50"
          onClick={handleStopTime}
          disabled={!initiated}
        >
          Stop Time
        </button>
      )}
      {isPaused && (
        <div className="flex gap-2">
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
            onClick={handleResumeTime}
            disabled={!initiated}
          >
            Resume Time
          </button>
          <button
            className="px-3 py-1 bg-gray-500 text-white rounded disabled:opacity-50"
            onClick={handleRegisterTime}
            disabled={!initiated || !timeCriterionEnabled}
          >
            Register Time
          </button>
        </div>
      )}
      {isPaused && timeCriterionEnabled && registeredTime !== null && (
        <div className="text-xs text-gray-700">Registered: {formatTime(registeredTime)}</div>
      )}
      <div className="flex gap-2">
      <button
        className="mt-10 px-12 py-12 bg-purple-600 text-white rounded hover:bg-purple-700 active:scale-95 transition flex flex-col items-center disabled:opacity-50"
        onClick={handleHoldClick}
        disabled={!initiated || !isRunning}
        >
        <div className="flex flex-col items-center">
            <span className="text-xs font-medium">{currentClimber || ''}</span>
            <span>+1 Hold</span>
            <span className="text-sm">Score {holdCount} → {maxScore}</span>
        </div>
        </button>
        <button
          className="mt-10 px-4 py-5 bg-purple-600 text-white rounded hover:bg-purple-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleHalfHoldClick}
          disabled={!initiated || !isRunning || usedHalfHold}
        >
          + .1
        </button>
      </div>
      <button
        className="mt-10 px-3 py-1 bg-yellow-500 text-white rounded"
        onClick={handleInsertScore}
        disabled={!initiated || (!isRunning && !isPaused)}
      >
        Insert Score
      </button>
      <ModalScore
        isOpen={showScoreModal}
        competitor={currentClimber}
        initialScore={holdCount}
        maxScore={maxScore}
        registeredTime={timeCriterionEnabled ? registeredTime : undefined}
        onClose={() => setShowScoreModal(false)}
        onSubmit={(score) => {
          const timeToSend = timeCriterionEnabled ? registeredTime : undefined;
          submitScore(idx, score, currentClimber, timeToSend);
          clearRegisteredTime();
          setShowScoreModal(false);
          const boxes = JSON.parse(localStorage.getItem("listboxes") || "[]");
          const box = boxes?.[idx];
          if (box?.concurenti) {
            const competitorIdx = box.concurenti.findIndex(c => c.nume === currentClimber);
            if (competitorIdx !== -1) {
              box.concurenti[competitorIdx].marked = true;
              localStorage.setItem("listboxes", JSON.stringify(boxes));
            }
          }
        }}
      />
    </div>
  );
};

export default JudgePage;
