// src/hooks/useWebSocket.js
// Custom hook for managing robust WebSocket connection with outgoing queue

import { useRef, useCallback, useEffect } from 'react';

// Use ws:// for dev, wss:// for production automatically
const WS_URL = import.meta.env.VITE_WS_URL ||
  (typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : 'ws://localhost:3001');

/**
 * @param {Object} handlers - Event handlers
 */
export function useWebSocket(handlers) {
  const wsRef = useRef(null);
  const queueRef = useRef([]);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to', WS_URL);
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
      };

      ws.onerror = () => {
        console.warn('[WS] Connection failed – make sure backend is running on port 3001');
        handlersRef.current.onError?.({
          message: '⚠️ Cannot connect to server. Make sure the backend is running (cd server && node index.js)',
          recoverable: false,
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
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
      }
    };
  }, [connect]);

  return { connect, sendJSON, sendBinary, disconnect, wsRef };
}
