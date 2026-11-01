import { useEffect, useState } from "react";
import { createQueryStore } from "./queryCore";

export type QueryStatus = "idle" | "loading" | "success" | "error";
export interface QuerySnapshot<T> { status: QueryStatus; data?: T; error?: unknown }

const store = createQueryStore();

export function snapshot<T>(key: string): QuerySnapshot<T> { return store.snapshot(key) as QuerySnapshot<T>; }
export function fetchQuery<T>(key: string, loader: () => Promise<T>, staleMs = 30_000): Promise<T> { return store.fetch(key, loader, staleMs); }
export function invalidateQuery(prefix: string) { store.invalidate(prefix); }

export function useQuery<T>(key: string, loader: () => Promise<T>, staleMs = 30_000, enabled = true) {
  const [value, setValue] = useState<QuerySnapshot<T>>(() => snapshot<T>(key));
  useEffect(() => {
    const unsubscribe = store.subscribe(key, setValue as (value: QuerySnapshot<T>) => void);
    store.registerReloader(key, () => fetchQuery(key, loader, staleMs));
    if (enabled) void fetchQuery(key, loader, staleMs).catch(() => undefined);
    return unsubscribe;
  }, [key, enabled]);
  const retry = () => void fetchQuery(key, loader, staleMs).catch(() => undefined);
  return { ...value, retry };
}

let listenersInstalled = false;
export function installQueryLifecycleListeners() {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  const refetch = () => void store.refetchAll();
  window.addEventListener("focus", refetch);
  window.addEventListener("online", refetch);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refetch();
  });
  window.addEventListener("closedai:unit-changed", refetch);
  window.addEventListener("closedai:server-waking", (event: Event) => {
    if (!(event as CustomEvent<boolean>).detail) refetch();
  });
}
