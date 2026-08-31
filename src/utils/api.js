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
// The portal runs as a single instance on Render with its database on a
// persistent disk, so every deploy/restart briefly stops the old process
// before the new one is listening. During that gap Render's edge returns a
// 502/503/504 (or the connection is refused outright). These responses mean
// the request never reached the app, so it's safe to transparently retry —
// the user's "refresh and it worked" becomes automatic instead of an error.
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 3;       // up to 3 retries after the first try
const RETRY_BASE_MS = 600;          // backoff: ~0.6s, 1.2s, 2.4s (+ jitter)

// File uploads are exempt from the retry loop. Re-sending a multipart body
// means pushing every byte up the wire again: a 100 MB submission that hit one
// hiccup was being uploaded up to FOUR times before the user saw an error,
// which is most of "it takes ages and then won't do it". They are also POSTs
// with side effects — a retry after a request that actually landed can charge a
// second BOQ credit. One attempt, and a real error message.
function isUpload(options) {
  return typeof FormData !== 'undefined' && options.body instanceof FormData;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Estimator add-on endpoints share an extra password header. All Wave 1-5
  // endpoints sit under one of these prefixes.
  const ESTIMATOR_PREFIXES = ['/estimator', '/finance', '/change-orders', '/invoices', '/payment-schedules', '/documents', '/pm', '/materials', '/job-photos'];
  if (ESTIMATOR_PREFIXES.some(p => endpoint.startsWith(p))) {
    const eKey = getEstimatorKey();
    if (eKey) headers['x-estimator-key'] = eKey;
  }
  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Retry loop for transient gateway errors during a deploy/restart window.
  const maxRetries = isUpload(options) ? 0 : MAX_RETRY_ATTEMPTS;
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    } catch (networkErr) {
      // fetch rejects (TypeError) when the server is unreachable — e.g. the
      // connection is refused mid-restart. Retry the same way as a 502.
      if (attempt < maxRetries) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200);
        continue;
      }
      if (maxRetries === 0) {
        const err = new Error('The upload was interrupted — check your connection and try again. Large files over a slow connection can take several minutes.');
        err.cause = networkErr;
        throw err;
      }
      throw networkErr;
    }
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200);
      continue;
    }
    break;
  }

  if (res.status === 401) {
    // Only redirect to login if this is NOT a login/register request, and NOT
    // the session probe — AuthProvider fires /auth/me on load whenever a token
    // is stored, and if that token has expired the caller clears it and the
    // app continues as a guest (ProtectedRoute handles protected pages).
    const isAuthRequest = endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/register')
      || endpoint.startsWith('/auth/me');
    // Never bounce a PUBLIC page to the portal login. The builder's client
    // opens /q (quote), /v (variation), /i (invoice) and /magic links with no
    // portal account — a stale token left in the browser must not turn a
    // tokened public link into a login wall.
    const onPublicPage = /^\/(q|v|i)\/|^\/magic/.test(window.location.pathname);
    if (!isAuthRequest && !onPublicPage) {
      clearToken();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
    if (onPublicPage) clearToken();
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

/**
 * Upload a FormData body with real progress reporting.
 *
 * fetch() cannot report how much of a request body has gone out, so an upload
 * made with apiFetch shows the user nothing for however long it takes — which
 * on a site connection with a 100 MB drawing set is several minutes of a
 * spinner that looks identical to a hang. XMLHttpRequest still reports upload
 * progress, so this uses it for the one job fetch can't do.
 *
 * @param {string} endpoint  API path, e.g. '/submissions'
 * @param {FormData} formData
 * @param {{ onProgress?: (p: {loaded:number,total:number,percent:number|null}) => void,
 *           signal?: AbortSignal }} [options]
 * @returns {Promise<object>} parsed JSON response
 */
function apiUpload(endpoint, formData, options = {}) {
  const { onProgress, signal } = options;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${endpoint}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Content-Type is deliberately left unset — the browser adds it with the
    // multipart boundary.

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        onProgress({
          loaded: e.loaded,
          total: e.lengthComputable ? e.total : 0,
          percent: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null,
        });
      };
    }

    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (data) return resolve(data);
        return reject(new Error('The server sent a response we could not read. Please check My Projects before submitting again.'));
      }
      // Don't bounce to /login mid-upload — that would throw away everything
      // they typed. Tell them plainly instead; the next navigation will
      // redirect as usual.
      const message = xhr.status === 401
        ? 'Your session expired while uploading. Please open the portal in a new tab, sign in again, then resend.'
        : (data && data.error) || 'Upload failed (' + xhr.status + ')';
      const err = new Error(message);
      err.status = xhr.status;
      err.data = data || {};
      reject(err);
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted — check your connection and try again. Large files over a slow connection can take several minutes.'));
    xhr.ontimeout = () => reject(new Error('The upload timed out. Please try again, or send fewer files at once.'));
    xhr.onabort = () => {
      const err = new Error('Upload cancelled');
      err.name = 'AbortError';
      reject(err);
    };
    // No client-side timeout: the browser should wait as long as the transfer
    // is actually progressing. xhr.timeout defaults to 0 (no limit).

    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.send(formData);
  });
}

export {
  apiFetch, apiUpload, getToken, setToken, clearToken, streamChat,
  getEstimatorKey, setEstimatorKey, clearEstimatorKey,
};
