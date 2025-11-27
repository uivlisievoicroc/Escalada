import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { startTimer, stopTimer, resumeTimer, updateProgress, submitScore, requestState } from '../utilis/contestActions';
import ModalScore from './ModalScore';
import ModalModifyScore from './ModalModifyScore';

const JudgePage = () => {
  const { boxId } = useParams();
  const idx = Number(boxId);
  const [initiated, setInitiated] = useState(false);
  const [started, setStarted] = useState(false);
  const [timerState, setTimerState] = useState("idle");
  const [usedHalfHold, setUsedHalfHold] = useState(false);
  const [currentClimber, setCurrentClimber] = useState("");
  const [holdCount, setHoldCount] = useState(0);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [maxScore, setMaxScore] = useState(0);
  // WebSocket subscription to backend for real-time updates
  const wsRef = useRef(null);
  
useEffect(() => {
    // Fetch initial state snapshot (manual reconnection)
    (async () => {
      try {
        const res = await fetch(`/api/state/${idx}`);
        if (res.ok) {
          const st = await res.json();
          setInitiated(st.initiated);
          setMaxScore(st.holdsCount);
          setCurrentClimber(st.currentClimber);
          setStarted(st.started);
          setTimerState(st.timerState || (st.started ? "running" : "idle"));
          setHoldCount(st.holdCount);
        }
      } catch (e) {
        console.error("Error fetching initial state:", e);
      }
    })();
    // Build WebSocket URL based on how the page was loaded
    const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const WS_HOST = window.location.hostname;
    const WS_PORT = 8000;            // backend port
    const WS_URL = `${WS_PROTOCOL}://${WS_HOST}:${WS_PORT}/api/ws/${idx}`;
    const ws = new WebSocket(WS_URL);
    // No ws.send REQUEST_STATE on open anymore
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
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
        setStarted(false);
        setTimerState("idle");
        setUsedHalfHold(false);
        setHoldCount(0);
      }
      if (msg.type === 'START_TIMER') {
        setStarted(true);
        setTimerState("running");
      }
      if (msg.type === 'STOP_TIMER') {
        setStarted(false);
        setTimerState("paused");
      }
      if (msg.type === 'RESUME_TIMER') {
        setStarted(true);
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
        setStarted(false);
        setTimerState("idle");
        setUsedHalfHold(false);
        setHoldCount(0);
      }
      // Handle state snapshot from ControlPanel
      if (msg.type === 'STATE_SNAPSHOT') {
        setInitiated(msg.initiated);
        setMaxScore(msg.holdsCount);
        setCurrentClimber(msg.currentClimber || '');
        setStarted(msg.started);
        setTimerState(msg.timerState || (msg.started ? "running" : "idle"));
        setHoldCount(msg.holdCount || 0);
      }
      // Handle ACTIVE_CLIMBER broadcast
      if (msg.type === 'ACTIVE_CLIMBER') {
        setCurrentClimber(msg.competitor || '');
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [idx]);


  
  // Handler for Start Time
  const handleStartTime = () => {
    startTimer(idx);
    setStarted(true);
    setTimerState("running");
  };

  const handleStopTime = () => {
    stopTimer(idx);
    setStarted(false);
    setTimerState("paused");
  };

  const handleResumeTime = () => {
    resumeTimer(idx);
    setStarted(true);
    setTimerState("running");
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
            disabled={!initiated}
          >
            Register Time
          </button>
        </div>
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
        disabled={!initiated || !isRunning}
      >
        Insert Score
      </button>
      <ModalScore
        isOpen={showScoreModal}
        competitor={currentClimber}
        initialScore={holdCount}
        maxScore={maxScore}
        onClose={() => setShowScoreModal(false)}
        onSubmit={(score) => {
          submitScore(idx, score, currentClimber);
          setShowScoreModal(false);
          const boxes = JSON.parse(localStorage.getItem("listboxes") || "[]");
          const box = boxes[idx];
          const competitorIdx = box.concurenti.findIndex(c => c.nume === currentClimber);
          if (competitorIdx !== -1) {
            box.concurenti[competitorIdx].marked = true;
            localStorage.setItem("listboxes", JSON.stringify(boxes));
          }
          setShowScoreModal(false);
        }}
      />
    </div>
  );
};

export default JudgePage;
