import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useScanWorkspace } from "./ScanWorkspaceProvider.jsx";

/** Reuse genuine server responses while moving between workflow stages.
 * `loader` must be useCallback-stable. The existing FIX debounce is retained;
 * cached responses never wait for it. Subscriptions clean up on navigation,
 * but a shared request may finish and populate its own key for the next visit.
 */
export function useWorkspaceResource(key, loader, debounceMs = 0) {
  const { resources } = useScanWorkspace();
  const subscribe = useCallback((listener) => resources.subscribe(key, listener), [resources, key]);
  const read = useCallback(() => resources.peek(key), [resources, key]);
  const snapshot = useSyncExternalStore(subscribe, read, read);

  useEffect(() => {
    if (!key || resources.peek(key).status !== "idle") return;
    const load = () => { void resources.load(key, loader).catch(() => {}); };
    if (!debounceMs) {
      load();
      return;
    }
    const timer = window.setTimeout(load, debounceMs);
    return () => window.clearTimeout(timer);
  }, [resources, key, loader, debounceMs]);

  const retry = useCallback(() => {
    if (!key || resources.peek(key).status === "pending") return;
    resources.invalidate(key);
    void resources.load(key, loader).catch(() => {});
  }, [resources, key, loader]);

  return {
    data: key ? snapshot.data : null,
    error: key ? snapshot.error : null,
    loading: Boolean(key) && (snapshot.status === "idle" || snapshot.status === "pending"),
    retry,
  };
}
