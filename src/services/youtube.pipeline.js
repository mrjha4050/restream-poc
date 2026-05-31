/** In-memory go-live pipeline state keyed by express session id */

const pipelines = new Map();

function setPipelineState(sessionId, state) {
  if (!sessionId) return;
  pipelines.set(sessionId, { ...state, updatedAt: new Date().toISOString() });
}

function getPipelineState(sessionId) {
  return pipelines.get(sessionId) || { phase: 'idle' };
}

function clearPipelineState(sessionId) {
  if (sessionId) pipelines.delete(sessionId);
}

module.exports = {
  setPipelineState,
  getPipelineState,
  clearPipelineState,
};
