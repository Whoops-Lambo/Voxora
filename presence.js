// Short, in-memory leases keep active HTTP clients visible when SSE is blocked.
// Sessions and presence are deliberately not written on each heartbeat.
export function createPresence({ now = Date.now, lifetime = 30000 } = {}) {
  const leases = new Map();
  return {
    touch(userId, session) {
      leases.set(session.hash, { userId, expires: Math.min(session.expires, now() + lifetime) });
    },
    online(userId) {
      return [...leases.values()].some(lease => lease.userId === userId && lease.expires > now());
    },
    forgetSession(hash) { leases.delete(hash); },
    forgetUser(userId) { for (const [hash, lease] of leases) if (lease.userId === userId) leases.delete(hash); },
    sweep() {
      let changed = false;
      for (const [hash, lease] of leases) if (lease.expires <= now()) { leases.delete(hash); changed = true; }
      return changed;
    },
  };
}
