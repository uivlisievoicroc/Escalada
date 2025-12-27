import { useEffect, useRef, useState } from 'react';

const logger = console;

export function useWebSocketWithHeartbeat(url, onMessage) {
  const [connected, setConnected] = useState(false);
  const [wsInstance, setWsInstance] = useState(null);
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  const isConnectingRef = useRef(false);
  const generationRef = useRef(0); // ignore late events from stale effects

  // Keep latest handler without recreating the socket
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const currentGen = ++generationRef.current;
    let reconnectTimeoutId = null;

    const connect = () => {
      if (currentGen !== generationRef.current) return;

      // Avoid duplicate attempts while handshake is in progress
      if (isConnectingRef.current) {
        logger.debug('[WebSocket] Already connecting, skipping duplicate attempt');
        return;
      }

      // Skip if an open/connecting socket already exists
      if (wsRef.current) {
        const state = wsRef.current.readyState;
        if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
          logger.debug('[WebSocket] Connection already exists, skipping');
          return;
        }
      }

      isConnectingRef.current = true;

      try {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          isConnectingRef.current = false;
          console.log('🟢 [Hook onopen] TRIGGERED for', url, 'readyState:', ws.readyState, 'timestamp:', new Date().toISOString());
          logger.log(`[WebSocket] Connected to ${url}`);
          console.log('🟢 [Hook onopen] Setting connected=true and wsInstance');
          setConnected(true);
          reconnectAttemptsRef.current = 0;
          wsRef.current = ws;
          setWsInstance(ws);
        };

        ws.onmessage = (event) => {
          if (currentGen !== generationRef.current) return;

          try {
            const msg = JSON.parse(event.data);

            // Heartbeat handling: reply immediately
            if (msg.type === 'PING') {
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
                } catch (e) {
                  logger.warn(`[WebSocket] Failed to send PONG: ${e}`);
                }
              }
              return;
            }

            if (onMessageRef.current) {
              try {
                onMessageRef.current(msg);
              } catch (e) {
                logger.error(`[WebSocket] onMessage handler error: ${e}`);
              }
            }
          } catch (e) {
            logger.warn(`[WebSocket] Parse error: ${e}`);
          }
        };

        ws.onclose = () => {
          isConnectingRef.current = false;
          console.log('🔌 [Hook onclose] CLOSED for', url, 'timestamp:', new Date().toISOString());
          logger.log(`[WebSocket] Disconnected from ${url}`);
          setConnected(false);
          setWsInstance(null);

          // Exponential backoff: 1s, 2s, 4s, ... max 30s
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current || 0), 30000);
          reconnectAttemptsRef.current = (reconnectAttemptsRef.current || 0) + 1;
          console.log(`🔄 [Hook onclose] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          logger.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutId = setTimeout(connect, delay);
        };

        ws.onerror = (event) => {
          isConnectingRef.current = false;
          console.log('🔴 [Hook onerror] ERROR for', url, 'event:', event, 'timestamp:', new Date().toISOString());
          logger.error('[WebSocket] Error:', event);
        };

        wsRef.current = ws;
      } catch (e) {
        isConnectingRef.current = false;
        logger.error(`[WebSocket] Connection failed: ${e}`);
      }
    };

    connect();

    return () => {
      // Invalidate this generation so late events are ignored
      if (currentGen === generationRef.current) {
        generationRef.current += 1;
      }
      // Reset connecting flag so a StrictMode cleanup doesn't block next connect
      isConnectingRef.current = false;
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);

      // Only close if not in handshake; avoids "closed before established"
      if (wsRef.current && !isConnectingRef.current) {
        const state = wsRef.current.readyState;
        if (state !== WebSocket.CLOSED && state !== WebSocket.CLOSING) {
          wsRef.current.close();
        }
      }
      wsRef.current = null;
      setWsInstance(null);
      setConnected(false);
    };
  }, [url]);

  return {
    ws: wsInstance,
    connected,
    reconnect: () => {
      // Force reconnect by closing existing socket; connect loop will re-open
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try { wsRef.current.close(); } catch {}
      }
    },
    send: (msg) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
  };
}

export default useWebSocketWithHeartbeat;
