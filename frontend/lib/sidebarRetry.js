const SIDEBAR_SKELETON_TIMEOUT_MS = 8000;
const RETRY_WINDOW_MS = 90_000;
const RETRY_DELAYS = [1500, 3000, 6000, 10_000];

function isRetryable(error) {
  return error?.retryable === true || error?.name === "TimeoutError" || error instanceof TypeError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retrySidebarLoad(load, options = {}) {
  const now = options.now ?? Date.now;
  const pause = options.sleep ?? sleep;
  const delays = options.delays ?? RETRY_DELAYS;
  const deadline = now() + (options.timeoutMs ?? RETRY_WINDOW_MS);
  let retries = 0;
  let lastError;
  while (now() < deadline) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || now() >= deadline) throw error;
      retries += 1;
      options.onRetry?.(error, retries);
      const delay = Math.min(delays[Math.min(retries - 1, delays.length - 1)], deadline - now());
      if (delay < 0) break;
      await pause(delay);
    }
  }
  options.onTimeout?.();
  throw lastError ?? new Error("The sidebar refresh timed out.");
}

function refreshSidebar(cache, load, onCached, onFresh, options) {
  if (cache) onCached(cache);
  return retrySidebarLoad(load, options).then(data => {
    onFresh(data);
    return data;
  });
}

function startSidebarLoadingDeadline(onDeadline, schedule = setTimeout, cancel = clearTimeout) {
  const timer = schedule(onDeadline, SIDEBAR_SKELETON_TIMEOUT_MS);
  return () => cancel(timer);
}

module.exports = {
  SIDEBAR_SKELETON_TIMEOUT_MS,
  RETRY_WINDOW_MS,
  retrySidebarLoad,
  refreshSidebar,
  startSidebarLoadingDeadline,
};
