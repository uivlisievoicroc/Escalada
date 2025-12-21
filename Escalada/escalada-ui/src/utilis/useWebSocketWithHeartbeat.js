import { useEffect, useRef, useCallback } from 'react';

export function useWebSocketWithHeartbeat(url, onMessage, options = {}) {
  const {
    heartbeatInterval = 30000,
    reconnectDelay = 1000,
    maxReconnectDelay = 30000,
    reconnectDecay = 1.5,
    maxReconnectAttempts = Infinity,
    onOpen = () => {},
    onClose = () => {},
    onError = () => {},
  } = options;

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const currentReconnectDelayRef = useRef(reconnectDelay);
  const shouldReconnectRef = useRef(true);
  const lastPongRef = useRef(Date.now());

  const cleanup = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();
    if (!shouldReconnectRef.current) return;

    try {
      const ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('WebSocket connected:', url);
        reconnectAttemptsRef.current = 0;
        currentReconnectDelayRef.current = reconnectDelay;
        lastPongRef.current = Date.now();
        
        heartbeatIntervalRef.current = setInterval(() => {
          const now = Date.now();
          const timeSinceLastPong = now - lastPongRef.current;
          
          if (timeSinceLastPong > heartbeatInterval * 2) {
            console.warn('Heartbeat timeout, reconnecting...');
            ws.close();
            return;
          }
          
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'PONG', timestamp: now }));
            } catch (err) {
              console.error('Failed to send PONG:', err);
            }
          }
        }, heartbeatInterval);
        
        onOpen(ws);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'PING') {
            lastPongRef.current = Date.now();
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
            }
            return;
          }
          
          onMessage(msg, ws);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', url, error);
        onError(error);
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', url);
        cleanup();
        onClose(event);

        if (shouldReconnectRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(currentReconnectDelayRef.current, maxReconnectDelay);
          
          console.log('Reconnecting in', delay, 'ms');
          
          reconnectTimeoutRef.current = setTimeout(() => {
            currentReconnectDelayRef.current = Math.min(
              currentReconnectDelayRef.current * reconnectDecay,
              maxReconnectDelay
            );
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('WebSocket connection error:', err);
    }
  }, [url, onMessage, onOpen, onClose, onError, cleanup, heartbeatInterval, reconnectDelay, maxReconnectDelay, reconnectDecay, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    cleanup();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    wsRef.current = null;
  }, [cleanup]);

  const reconnect = useCallback(() => {
    disconnect();
    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    currentReconnectDelayRef.current = reconnectDelay;
    connect();
  }, [disconnect, connect, reconnectDelay]);

  useEffect(() => {
    connect();
    return () => {
      shouldReconnectRef.current = false;
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, cleanup]);

  return { ws: wsRef.current, reconnect, disconnect };
}

export default useWebSocketWithHeartbeat;
