// SSE delivers immediately; bounded HTTP reconciliation also repairs missed events.
export function createRealtime({ url, synchronize, onEvent, onStatus, onDisconnect, onUnauthorized, onError = () => {}, EventSource: Source = globalThis.EventSource }) {
  let stream, timer, active = false, busy = false, controller, healthy = false, lastEvent = 0, lastSuccess = 0, next = 0, failures = 0, phase;
  function status(value) { if (active && phase !== value) { phase = value; onStatus(value); } }
  function disconnected() { if (healthy) { healthy = false; onDisconnect(); } }
  async function pull() {
    if (!active || busy) return;
    busy = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    try {
      await synchronize(controller.signal);
      if (!active) return;
      lastSuccess = Date.now(); failures = 0;
      next = lastSuccess + (healthy ? 20000 : 5000);
      status(healthy ? 'live' : 'fallback');
    } catch (error) {
      if (!active) return;
      if (error.status === 401 || error.account && error.status === 403) { api.close(); onUnauthorized(error); return; }
      failures++;
      next = Date.now() + Math.min(30000, 5000 * 2 ** Math.min(failures - 1, 3));
      status('offline');
    } finally { clearTimeout(timeout); controller = null; busy = false; }
  }
  function tick() {
    if (healthy && Date.now() - lastEvent > 30000) { disconnected(); next = Math.min(next, Date.now()); }
    if (Date.now() >= next) pull();
  }
  function wake() { if (globalThis.document?.visibilityState !== 'hidden') { next = 0; pull(); } }
  const api = {
    start() {
      if (active) return;
      active = true; status('connecting');
      try {
        stream = new Source(url);
        stream.onmessage = event => {
          if (!active) return;
          let data; try { data = JSON.parse(event.data); } catch { return; }
          if (!data || typeof data.type !== 'string') return;
          healthy = true; lastEvent = Date.now(); status('live');
          if (data.type !== 'heartbeat') Promise.resolve(onEvent(data)).catch(error => { if (active) onError(error); });
        };
        stream.onerror = () => {
          if (!active) return;
          disconnected();
          if (phase !== 'offline') status(lastSuccess && Date.now() - lastSuccess < 15000 ? 'fallback' : 'connecting');
          next = Math.min(next, lastSuccess + 5000);
          tick();
        };
      } catch { status('connecting'); }
      timer = setInterval(tick, 1000);
      globalThis.addEventListener?.('online', wake);
      globalThis.addEventListener?.('focus', wake);
      globalThis.document?.addEventListener('visibilitychange', wake);
      pull();
    },
    request: wake,
    close() {
      active = false; stream?.close(); controller?.abort(); clearInterval(timer);
      globalThis.removeEventListener?.('online', wake);
      globalThis.removeEventListener?.('focus', wake);
      globalThis.document?.removeEventListener('visibilitychange', wake);
    },
  };
  return api;
}
