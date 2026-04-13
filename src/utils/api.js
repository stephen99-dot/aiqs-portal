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
async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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

      // SSE error response (e.g. multer field-size limit) — parse the SSE event
      if (!res.ok && isSSE) {
        try {
          const text = await res.text();
          const match = text.match(/^data:\s*(.+)$/m);
          if (match) {
            const evt = JSON.parse(match[1]);
            const err = new Error(evt.message || 'Something went wrong');
            err.status = res.status;
            err.data = evt;
            if (onError) onError(err);
            return;
          }
        } catch(e) { /* fall through */ }
        const err = new Error('Server error (' + res.status + ')');
        err.status = res.status;
        err.data = {};
        if (onError) onError(err);
        return;
      }

      if (!res.ok || !isSSE) {
        // Fallback to regular JSON response
        let data;
        try { data = await res.json(); } catch(e) { data = { error: 'Server error (' + res.status + ')' }; }
        if (!res.ok) {
          const err = new Error(data.error || 'Something went wrong');
          err.status = res.status;
          err.data = data;
          if (onError) onError(err);
          return;
        }
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

export { apiFetch, getToken, setToken, clearToken, streamChat };
