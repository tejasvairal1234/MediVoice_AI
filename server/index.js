// server/index.js
// MediVoice AI – Main server entry point
// Express REST API + WebSocket server for real-time call handling

require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = (function () {
  // inline uuid v4 without requiring uuid package
  function v4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  return { v4 };
})();

const { transcribeAudio } = require('./services/stt');
const { synthesizeSpeech } = require('./services/tts');
const { getAIResponse, getGreeting, getContinuationGreeting, generateHealthReport } = require('./services/llm');
const {
  createSession,
  getSession,
  addMessage,
  updateSession,
  deleteSession,
} = require('./sessionManager');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'MediVoice AI' }));

// Get session report via REST (fallback)
app.get('/report/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.report) return res.status(202).json({ error: 'Report not ready yet' });
  res.json(session.report);
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

// Helper: send JSON message to a client
function sendJSON(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Helper: send binary audio + metadata to client
function sendAudio(ws, audioBuffer, metadata = {}) {
  if (ws.readyState !== WebSocket.OPEN || !audioBuffer || !Buffer.isBuffer(audioBuffer)) return;
  // Prefix with JSON header length (4 bytes) + JSON header + audio data
  const headerJson = JSON.stringify({ type: 'audio', ...metadata });
  const headerBuf = Buffer.from(headerJson, 'utf8');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(headerBuf.length, 0);
  const combined = Buffer.concat([lengthBuf, headerBuf, audioBuffer]);
  ws.send(combined);
}

wss.on('connection', (ws) => {
  const sessionId = uuidv4();
  console.log(`[WS] New connection: ${sessionId}`);

  // State for this connection
  let audioChunks = [];
  let isCollectingAudio = false;

  // Send session ID to client immediately
  sendJSON(ws, { type: 'connected', sessionId });

  ws.on('message', async (data) => {
    try {
      // Check if it's a text (JSON) message or binary (audio)
      if (typeof data === 'string' || data instanceof Buffer && !isCollectingAudio) {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          // It's raw audio binary data (while collecting)
          if (isCollectingAudio) {
            audioChunks.push(data);
            return;
          }
          return;
        }

        await handleJSONMessage(ws, sessionId, msg);
      } else {
        // Binary audio chunk during recording
        if (isCollectingAudio) {
          audioChunks.push(data);
        }
      }
    } catch (err) {
      console.error(`[WS] Error handling message for ${sessionId}:`, err);
      sendJSON(ws, { type: 'error', message: 'Internal server error. Please try again.' });
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Connection closed: ${sessionId}`);
    // Cleanup session after delay (keep report accessible briefly)
    setTimeout(() => deleteSession(sessionId), 60 * 60 * 1000); // 1 hour
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for ${sessionId}:`, err.message);
  });

  // ---- Message handler ----
  async function handleJSONMessage(ws, sessionId, msg) {
    switch (msg.type) {
      // ---- START CALL ----
      case 'start_call': {
        createSession(sessionId);
        updateSession(sessionId, { status: 'greeting' });
        sendJSON(ws, { type: 'call_started', sessionId });

        // Get AI greeting
        sendJSON(ws, { type: 'ai_thinking' });
        try {
          const greeting = await getGreeting();
          addMessage(sessionId, 'assistant', greeting);
          updateSession(sessionId, { status: 'active' });

          // TTS for greeting (sent once with browser/audio flag)
          const audioBuffer = await synthesizeSpeech(greeting);
          if (audioBuffer) {
            sendJSON(ws, { type: 'ai_text', text: greeting });
            sendAudio(ws, audioBuffer, { text: greeting });
          } else {
            sendJSON(ws, { type: 'ai_text', text: greeting, useBrowserTTS: true });
          }
        } catch (err) {
          console.error('[LLM/TTS] Greeting error:', err);
          sendJSON(ws, { type: 'error', message: `Could not start call: ${err.message || 'Check your API key'}` });
        }
        break;
      }

      // ---- RESTART / RESUME CALL WITH PREVIOUS CHAT HISTORY ----
      case 'restart_call': {
        let session = getSession(sessionId);
        if (!session) {
          createSession(sessionId);
          session = getSession(sessionId);
        }

        // If client provided history, sync or retain existing session history
        if (Array.isArray(msg.history) && msg.history.length > 0) {
          session.history = msg.history.map((h) => ({
            role: h.role === 'ai' ? 'assistant' : (h.role || 'user'),
            content: h.content || h.text || '',
          }));
        }

        updateSession(sessionId, { status: 'greeting' });
        sendJSON(ws, { type: 'call_started', sessionId, isResume: true });

        // Get AI continuation greeting based on previous history
        sendJSON(ws, { type: 'ai_thinking' });
        try {
          const greeting = await getContinuationGreeting(session.history);
          addMessage(sessionId, 'assistant', greeting);
          updateSession(sessionId, { status: 'active' });

          const audioBuffer = await synthesizeSpeech(greeting);
          if (audioBuffer) {
            sendJSON(ws, { type: 'ai_text', text: greeting });
            sendAudio(ws, audioBuffer, { text: greeting });
          } else {
            sendJSON(ws, { type: 'ai_text', text: greeting, useBrowserTTS: true });
          }
        } catch (err) {
          console.error('[LLM/TTS] Restart greeting error:', err);
          sendJSON(ws, { type: 'error', message: `Could not resume call: ${err.message || 'Error resuming session'}` });
        }
        break;
      }

      // ---- INSTANT DIRECT TEXT MESSAGE (0ms latency STT from browser) ----
      case 'user_message': {
        const session = getSession(sessionId);
        if (!session || session.status === 'ended') break;
        const userText = msg.text?.trim();
        if (!userText) break;

        // Clear audioChunks to prevent any leftover audio_end processing
        audioChunks = [];
        isCollectingAudio = false;

        addMessage(sessionId, 'user', userText);
        sendJSON(ws, { type: 'user_text', text: userText });

        // Fast LLM response (< 200ms)
        sendJSON(ws, { type: 'ai_thinking' });
        try {
          const aiResult = await getAIResponse(session.history.slice(0, -1), userText);
          const aiText = typeof aiResult === 'object' ? aiResult.text : aiResult;
          const isCompleted = typeof aiResult === 'object' ? !!aiResult.isCompleted : false;
          
          addMessage(sessionId, 'assistant', aiText);

          const ttsAudio = await synthesizeSpeech(aiText);
          if (ttsAudio) {
            sendJSON(ws, { type: 'ai_text', text: aiText, isCompleted });
            sendAudio(ws, ttsAudio, { text: aiText, isCompleted });
          } else {
            sendJSON(ws, { type: 'ai_text', text: aiText, isCompleted, useBrowserTTS: true });
          }
        } catch (err) {
          console.error('[LLM] Error:', err);
          sendJSON(ws, { type: 'error', message: err.message, recoverable: true });
        }
        break;
      }

      // ---- AUDIO CHUNK START ----
      case 'audio_start': {
        audioChunks = [];
        isCollectingAudio = true;
        sendJSON(ws, { type: 'recording_started' });
        break;
      }

      // ---- AUDIO CHUNK (binary is handled above, but handle base64 here too) ----
      case 'audio_chunk': {
        if (msg.data && isCollectingAudio) {
          const buf = Buffer.from(msg.data, 'base64');
          audioChunks.push(buf);
        }
        break;
      }

      // ---- AUDIO END – process fallback audio turn ----
      case 'audio_end': {
        isCollectingAudio = false;
        const session = getSession(sessionId);
        if (!session || session.status === 'ended') break;
        if (audioChunks.length === 0) {
          // No audio chunks or already processed by user_message -> do nothing
          break;
        }

        const audioBuffer = Buffer.concat(audioChunks);
        audioChunks = [];

        sendJSON(ws, { type: 'processing' });

        try {
          // STT: Whisper Large v3 Turbo freely auto-detects English, Marathi, Spanish, etc.
          const { text: userText, language: detectedLang } = await transcribeAudio(
            audioBuffer,
            null
          );

          if (!userText || userText.trim().length < 2) {
            sendJSON(ws, {
              type: 'error',
              message: "I didn't catch that. Could you please speak again?",
              recoverable: true,
            });
            break;
          }

          // Update detected language
          updateSession(sessionId, { detectedLanguage: detectedLang });
          addMessage(sessionId, 'user', userText);
          sendJSON(ws, { type: 'user_text', text: userText, language: detectedLang });

          // LLM
          sendJSON(ws, { type: 'ai_thinking' });
          const aiResult = await getAIResponse(session.history.slice(0, -1), userText);
          const aiText = typeof aiResult === 'object' ? aiResult.text : aiResult;
          const isCompleted = typeof aiResult === 'object' ? !!aiResult.isCompleted : false;
          
          addMessage(sessionId, 'assistant', aiText);

          // TTS in detected language
          const ttsAudio = await synthesizeSpeech(aiText, detectedLang !== 'en' ? detectedLang : null);
          if (ttsAudio) {
            sendJSON(ws, { type: 'ai_text', text: aiText, isCompleted });
            sendAudio(ws, ttsAudio, { text: aiText, isCompleted });
          } else {
            sendJSON(ws, { type: 'ai_text', text: aiText, isCompleted, useBrowserTTS: true });
          }
        } catch (err) {
          console.error('[Pipeline] Error processing audio turn:', err);
          sendJSON(ws, {
            type: 'error',
            message: `Error: ${err.message || 'There was an issue processing your audio. Please try speaking again.'}`,
            recoverable: true,
          });
        }
        break;
      }

      // ---- END CALL ----
      case 'end_call': {
        const session = getSession(sessionId);
        if (!session) break;
        updateSession(sessionId, { status: 'ended' });
        sendJSON(ws, { type: 'generating_report' });

        try {
          const report = await generateHealthReport(session.history);
          updateSession(sessionId, { report });
          sendJSON(ws, { type: 'report_ready', report, sessionId });
        } catch (err) {
          console.error('[Report] Error generating report:', err);
          sendJSON(ws, {
            type: 'report_ready',
            report: {
              chiefComplaint: 'Report generation failed. Please review the transcript.',
              patientName: 'Not provided',
              symptomHistory: {
                onset: 'Not collected',
                progression: 'Not collected',
                associatedSymptoms: 'Not collected',
              },
              severity: { painLevel: null, trend: 'unknown' },
              duration: 'Not collected',
              medicalHistory: 'Not collected',
              aiFlags: ['Report generation error – manual review needed'],
              recommendedAction: 'Please consult a healthcare provider.',
              callQuality: 'partial',
              language: session.detectedLanguage || 'en',
            },
            sessionId,
          });
        }
        break;
      }

      default:
        console.warn(`[WS] Unknown message type: ${msg.type}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🏥 MediVoice AI Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready on ws://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn('\n⚠️  WARNING: GROQ_API_KEY is not set! Check your server/.env file.\n');
  }
});
