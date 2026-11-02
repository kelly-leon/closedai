const inflight = new Map<string, Promise<unknown>>();
const values = new Map<string, { value: unknown; expires: number }>();

export function sharedGet<T>(key: string, load: () => Promise<T>, ttlMs = 30_000): Promise<T> {
  const cached = values.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value as T);
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = load().then(value => {
    values.set(key, { value, expires: Date.now() + ttlMs });
    inflight.delete(key);
    return value;
  }).catch(error => {
    inflight.delete(key);
    throw error;
  });
  inflight.set(key, promise);
  return promise;
}

export function invalidateShared(prefix: string) {
  for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
}

export function setShared<T>(key: string, value: T, ttlMs = 30_000) {
  values.set(key, { value, expires: Date.now() + ttlMs });
}

export async function removeDocumentCached(unitId: string, id: string) {
  const key = `documents:${unitId}`;
  const cached = values.get(key);
  if (!cached) return;
  const documents = cached.value as Array<{ id: string }>;
  values.set(key, { value: documents.filter(document => document.id !== id), expires: cached.expires });
}
