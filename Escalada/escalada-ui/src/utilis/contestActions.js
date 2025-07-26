const API_PROTOCOL = window.location.protocol === 'https:' ? 'https' : 'http';
const API = `${API_PROTOCOL}://${window.location.hostname}:8000/api/cmd`;
// src/utils/contestActions.js

export async function startTimer(boxId) {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, type: 'START_TIMER' })
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
export async function submitScore(boxId, score, competitor) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxId, type: 'SUBMIT_SCORE', score, competitor }),
  });
}

/**
 * Initialize a new route in the contest
 */
export async function initRoute(boxId, routeIndex, holdsCount, competitors) {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxId, type: 'INIT_ROUTE', routeIndex, holdsCount, competitors }),
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
