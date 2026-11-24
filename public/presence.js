// A finite, non-streaming request keeps a background tab present even when the
// browser throttles UI timers. Closing the tab starts the server's reconnect grace.
let active = null;
export function keepPresence(id) {
  if ((active?.id ?? null) === (id ?? null)) return;
  active?.controller.abort();
  active = null;
  if (!id) return;
  const lease = {id,controller:new AbortController()};
  active = lease;
  void (async () => {
    while (active === lease) {
      try {
        const response = await fetch('/api/rooms/' + encodeURIComponent(id) + '/presence', {
          cache:'no-store',signal:lease.controller.signal
        });
        if (response.status === 401 || response.status === 404) { if (active === lease) active = null; return; }
        if (!response.ok) throw new Error('Lease temporarily unavailable');
      } catch {
        if (active !== lease) return;
        await new Promise(resolve => setTimeout(resolve,2500));
      }
    }
  })();
}
