/** Immutable scan-derived responses, scoped to one mounted workspace.
 * This is not persistence: each key includes its scan/selection/verification ID.
 * Pending requests are shared; failures remain errors until an explicit retry.
 */
const EMPTY = Object.freeze({ status: "idle", data: null, error: null });

export function createWorkspaceResources(limit = 20) {
  const entries = new Map();
  const listeners = new Map();

  function notify(key) {
    for (const listener of listeners.get(key) ?? []) listener();
  }

  function prune() {
    for (const [key, entry] of entries) {
      if (entries.size <= limit) break;
      if (entry.snapshot.status === "pending" || listeners.get(key)?.size) continue;
      entries.delete(key);
    }
  }

  return {
    peek(key) {
      return entries.get(key)?.snapshot ?? EMPTY;
    },
    subscribe(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => {
        const group = listeners.get(key);
        group?.delete(listener);
        if (group?.size === 0) listeners.delete(key);
        prune();
      };
    },
    load(key, loader) {
      const existing = entries.get(key);
      if (existing) return existing.promise;
      const entry = { snapshot: { status: "pending", data: null, error: null }, promise: null };
      entries.set(key, entry);
      entry.promise = Promise.resolve().then(loader).then(
        (data) => {
          if (entries.get(key) === entry) {
            entry.snapshot = { status: "fulfilled", data, error: null };
            notify(key);
            prune();
          }
          return data;
        },
        (error) => {
          if (entries.get(key) === entry) {
            entry.snapshot = { status: "rejected", data: null, error };
            notify(key);
            prune();
          }
          throw error;
        },
      );
      notify(key);
      return entry.promise;
    },
    prime(key, data) {
      entries.set(key, {
        snapshot: { status: "fulfilled", data, error: null },
        promise: Promise.resolve(data),
      });
      notify(key);
      prune();
    },
    invalidate(key) {
      entries.delete(key);
      notify(key);
    },
  };
}
