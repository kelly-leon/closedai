export const SIDEBAR_SKELETON_TIMEOUT_MS: number;
export const RETRY_WINDOW_MS: number;
export function retrySidebarLoad<T>(
  load: () => Promise<T>,
  options?: {
    timeoutMs?: number;
    delays?: number[];
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (error: unknown, retries: number) => void;
    onTimeout?: () => void;
  },
): Promise<T>;
export function refreshSidebar<TCache, TResult>(
  cache: TCache | null,
  load: () => Promise<TResult>,
  onCached: (cache: TCache) => void,
  onFresh: (data: TResult) => void,
  options?: Parameters<typeof retrySidebarLoad<TResult>>[1],
): Promise<TResult>;
export function startSidebarLoadingDeadline(
  onDeadline: () => void,
  schedule?: (callback: () => void, delay: number) => number,
  cancel?: (timer: number) => void,
): () => void;
