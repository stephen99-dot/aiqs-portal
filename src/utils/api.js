const API_BASE = '/api';
function getToken() {
  return localStorage.getItem('aiqs_token');
}
function setToken(token) {
  localStorage.setItem('aiqs_token', token);
}
function clearToken() {
  localStorage.removeItem('aiqs_token');
}

// Estimator add-on is gated by a shared password set by the operator.
// The key lives in localStorage so the user only enters it once per browser.
const ESTIMATOR_KEY_STORAGE = 'aiqs_estimator_key';
function getEstimatorKey() {
  return localStorage.getItem(ESTIMATOR_KEY_STORAGE) || '';
}
function setEstimatorKey(key) {
  if (key) localStorage.setItem(ESTIMATOR_KEY_STORAGE, key);
  else localStorage.removeItem(ESTIMATOR_KEY_STORAGE);
}
function clearEstimatorKey() {
  localStorage.removeItem(ESTIMATOR_KEY_STORAGE);
}
async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Estimator add-on endpoints share an extra password header. All Wave 1-5
  // endpoints sit under one of these prefixes.
  const ESTIMATOR_PREFIXES = ['/estimator', '/finance', '/change-orders', '/invoices', '/payment-schedules', '/documents'];
  if (ESTIMATOR_PREFIXES.some(p => endpoint.startsWith(p))) {
    const eKey = getEstimatorKey();
    if (eKey) headers['x-estimator-key'] = eKey;
  }
  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });
  if (res.status === 401) {
    // Only redirect to login if this is NOT a login/register request
    const isAuthRequest = endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/register');
    if (!isAuthRequest) {
      clearToken();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }
  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    if (!res.ok) {
      const err = new Error('Server error (' + res.status + ')');
      err.status = res.status;
      err.data = {};
      throw err;
    }
    throw parseErr;
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
/**
 * Stream a chat response via SSE (Server-Sent Events).
 * Falls back to regular POST if streaming endpoint unavailable.
 * @param {FormData} formData - The form data to send
 * @param {Object} callbacks - { onText, onThinking, onPipeline, onDone, onError }
 * @returns {AbortController} - Can be used to cancel the request
 */
function streamChat(formData, callbacks = {}) {
  const { onText, onThinking, onPipeline, onProgress, onDone, onError } = callbacks;
  const controller = new AbortController();
  const token = getToken();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
        signal: controller.signal,
      });

      if (res.status === 401) {
        clearToken();
        window.location.href = '/login';
        return;
      }

      const isSSE = res.headers.get('content-type')?.includes('text/event-stream');

      // Handle error responses (both JSON and SSE formats)
      if (!res.ok) {
        let errMsg = null;
        let errData = {};
        try {
          const text = await res.text();
          // Try SSE format first: data: {"type":"error","message":"..."}
          const sseMatch = text.match(/^data:\s*(.+)$/m);
          if (sseMatch) {
            const evt = JSON.parse(sseMatch[1]);
            errMsg = evt.message || evt.error;
            errData = evt;
          }
          // Try JSON format: {"error":"..."}
          if (!errMsg) {
            try {
              const json = JSON.parse(text);
              errMsg = json.error || json.message;
              errData = json;
            } catch(e) {}
          }
        } catch(e) { /* body unreadable */ }
        const err = new Error(errMsg || 'Something went wrong — please try again');
        err.status = res.status;
        err.data = errData;
        if (onError) onError(err);
        return;
      }

      if (!isSSE) {
        // Fallback to regular JSON response (non-error, non-SSE)
        let data;
        try { data = await res.json(); } catch(e) { data = { error: 'Server error (' + res.status + ')' }; }
        // Got a JSON response from the stream endpoint — treat as complete
        if (onDone) onDone(data);
        return;
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let fullThinking = '';
      let metadata = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const evt = JSON.parse(data);
              switch (evt.type) {
                case 'text':
                  fullText += evt.content;
                  if (onText) onText(fullText, evt.content);
                  break;
                case 'thinking':
                  fullThinking += evt.content;
                  if (onThinking) onThinking(fullThinking, evt.content);
                  break;
                case 'pipeline':
                  if (onPipeline) onPipeline(evt.stage);
                  break;
                case 'progress':
                  if (onProgress) onProgress(evt.stage, evt.detail);
                  break;
                case 'done':
                  metadata = evt;
                  if (onDone) onDone({
                    reply: fullText,
                    thinking: fullThinking || null,
                    ...evt,
                  });
                  break;
                case 'error':
                  if (onError) {
                    const err = new Error(evt.message || 'Stream error');
                    err.data = evt;
                    onError(err);
                  }
                  break;
              }
            } catch (parseErr) {
              // Skip malformed events
            }
          }
        }
      }

      // If stream ended without a 'done' event, send what we have
      if (!metadata.type && fullText) {
        if (onDone) onDone({ reply: fullText, thinking: fullThinking || null });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (onError) onError(err);
    }
  })();

  return controller;
}

export {
  apiFetch, getToken, setToken, clearToken, streamChat,
  getEstimatorKey, setEstimatorKey, clearEstimatorKey,
};
