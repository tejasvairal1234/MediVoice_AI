// server/sessionManager.js
// Manages per-call session state: conversation history, call status, detected language

const sessions = new Map();

/**
 * Create a new session
 * @param {string} sessionId
 */
function createSession(sessionId) {
  sessions.set(sessionId, {
    id: sessionId,
    history: [], // [{role: 'user'|'assistant', content: string}]
    status: 'idle', // idle | greeting | active | ended
    detectedLanguage: 'en',
    startTime: Date.now(),
    report: null,
  });
}

/**
 * Get session by ID
 * @param {string} sessionId
 */
function getSession(sessionId) {
  return sessions.get(sessionId);
}

/**
 * Add a message to the conversation history
 * @param {string} sessionId
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
function addMessage(sessionId, role, content) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.history.push({ role, content });
}

/**
 * Update session fields
 * @param {string} sessionId
 * @param {Object} updates
 */
function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) return;
  Object.assign(session, updates);
}

/**
 * Delete a session (cleanup)
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Get all session IDs (for debugging)
 */
function listSessions() {
  return Array.from(sessions.keys());
}

module.exports = {
  createSession,
  getSession,
  addMessage,
  updateSession,
  deleteSession,
  listSessions,
};
