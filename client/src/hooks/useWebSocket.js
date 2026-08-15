// src/hooks/useWebSocket.js
// Custom hook for managing robust WebSocket connection with outgoing queue, auto-reconnect & keepalive

import { useRef, useCallback, useEffect } from 'react';

// Production Render backend WebSocket endpoint
const RENDER_WS_URL = 'wss://medivoice-ai-1kpx.onrender.com';

function getWebSocketURL() {
  if (typeof window === 'undefined') return 'ws://localhost:3001';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'ws://localhost:3001';
  }
  // Production (Vercel / Render / Custom Domain)
  return import.meta.env.VITE_WS_URL || RENDER_WS_URL;
}

const WS_URL = getWebSocketURL();

/**
 * @param {Object} handlers - Event handlers
 */
export function useWebSocket(handlers) {
  const wsRef = useRef(null);
  const queueRef = useRef([]);
  const handlersRef = useRef(handlers);
  const pingIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      console.log('[WS] Connecting to:', WS_URL);
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected successfully to', WS_URL);
        
        // Start keep-alive ping every 25s (prevents Render from closing idle connections)
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch (_) {}
          }
        }, 25000);

        // Flush any queued messages
        while (queueRef.current.length > 0) {
          const item = queueRef.current.shift();
          try {
            ws.send(item);
          } catch (e) {
            console.error('[WS] Send queued item error:', e);
          }
        }
      };

      ws.onmessage = (event) => {
        const h = handlersRef.current;

        // Binary audio data
        if (event.data instanceof ArrayBuffer) {
          try {
            const view = new DataView(event.data);
            const headerLen = view.getUint32(0);
            const headerBytes = new Uint8Array(event.data, 4, headerLen);
            const header = JSON.parse(new TextDecoder().decode(headerBytes));
            const audioData = event.data.slice(4 + headerLen);

            if (header.type === 'audio') {
              h.onAudio?.(audioData, header);
            }
          } catch (err) {
            console.error('[WS] Parse binary error:', err);
          }
          return;
        }

        // Text JSON message
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'pong') return; // Keep-alive response

        switch (msg.type) {
          case 'connected':         h.onConnected?.(msg); break;
          case 'call_started':      h.onCallStarted?.(msg); break;
          case 'recording_started': h.onRecordingStarted?.(msg); break;
          case 'ai_thinking':       h.onAiThinking?.(msg); break;
          case 'processing':        h.onProcessing?.(msg); break;
          case 'user_text':         h.onUserText?.(msg); break;
          case 'ai_text':           h.onAiText?.(msg); break;
          case 'generating_report': h.onGeneratingReport?.(msg); break;
          case 'report_ready':      h.onReportReady?.(msg); break;
          case 'error':             h.onError?.(msg); break;
          default:
            console.warn('[WS] Unknown message type:', msg.type);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Connection closed');
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        
        // Auto-reconnect after 3 seconds if disconnected
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WS] Attempting auto-reconnect...');
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.warn('[WS] Connection failed to', WS_URL);
        handlersRef.current.onError?.({
          message: 'Connecting to MediVoice server on Render (please allow a moment if waking up)...',
          recoverable: true,
        });
      };
    } catch (err) {
      console.error('[WS] Connect error:', err);
    }
  }, []);

  const sendJSON = useCallback((data) => {
    const jsonStr = JSON.stringify(data);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(jsonStr);
    } else {
      queueRef.current.push(jsonStr);
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect();
      }
    }
  }, [connect]);

  const sendBinary = useCallback((buffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(buffer);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
      }
    };
  }, [connect]);

  return { connect, sendJSON, sendBinary, disconnect, wsRef };
}
