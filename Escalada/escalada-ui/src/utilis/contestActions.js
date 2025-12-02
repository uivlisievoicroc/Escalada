const API_PROTOCOL = window.location.protocol === 'https:' ? 'https' : 'http';
const API = `${API_PROTOCOL}://${window.location.hostname}:8000/api/cmd`;
// src/utils/contestActions.js

export async function startTimer(boxId) {
  try {
    localStorage.setItem(
      "timer-cmd",
      JSON.stringify({ type: "START_TIMER", boxId, ts: Date.now() })
    );
  } catch (err) {
    console.error("Failed to persist START_TIMER command", err);
  }
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, type: 'START_TIMER' })
    });
  }

  export async function stopTimer(boxId) {
  try {
    localStorage.setItem(
      "timer-cmd",
      JSON.stringify({ type: "STOP_TIMER", boxId, ts: Date.now() })
    );
  } catch (err) {
    console.error("Failed to persist STOP_TIMER command", err);
  }
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, type: 'STOP_TIMER' })
    });
  }

export async function resumeTimer(boxId) {
  try {
    localStorage.setItem(
      "timer-cmd",
      JSON.stringify({ type: "RESUME_TIMER", boxId, ts: Date.now() })
    );
  } catch (err) {
    console.error("Failed to persist RESUME_TIMER command", err);
  }
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, type: 'RESUME_TIMER' })
    });
  }
  
  export async function updateProgress(boxId, delta = 1) {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, type: 'PROGRESS_UPDATE', delta })
    });
  }
  
  export async function requestActiveCompetitor(boxId) {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, type: 'REQUEST_ACTIVE_COMPETITOR' })
    });
  }
export async function submitScore(boxId, score, competitor, registeredTime) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boxId,
      type: 'SUBMIT_SCORE',
      score,
      competitor,
      registeredTime: typeof registeredTime === "number" ? registeredTime : undefined,
    }),
  });
}

export async function registerTime(boxId, registeredTime) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boxId,
      type: 'REGISTER_TIME',
      registeredTime,
    }),
  });
}

/**
 * Initialize a new route in the contest
 */
export async function initRoute(boxId, routeIndex, holdsCount, competitors, timerPreset) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxId, type: 'INIT_ROUTE', routeIndex, holdsCount, competitors, timerPreset }),
  });
}

// REQUEST_STATE: ask ControlPanel to send a state snapshot for boxId
export async function requestState(boxId) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxId, type: 'REQUEST_STATE' })
  });
}
