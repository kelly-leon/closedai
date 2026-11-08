const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_COUNTS = [
  "documents_used",
  "document_quota",
  "tokens_available",
  "trial_tokens_remaining",
  "token_balance",
  "daily_used",
  "daily_cap",
  "messages_used",
  "message_quota",
];
const CACHE_PREFIX = "closedai-sidebar:v1:";

function sidebarCacheKey(userId) {
  return `${CACHE_PREFIX}${userId}`;
}

function readSidebarCache(storage, userId, now = Date.now()) {
  if (!userId) return null;
  const key = sidebarCacheKey(userId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const cache = JSON.parse(raw);
    if (
      cache.version !== CACHE_VERSION ||
      cache.userId !== userId ||
      !Number.isFinite(cache.timestamp) ||
      cache.timestamp > now ||
      now - cache.timestamp > CACHE_TTL_MS ||
      !Array.isArray(cache.units) ||
      !Array.isArray(cache.conversations)
    ) {
      storage.removeItem(key);
      return null;
    }
    return cache;
  } catch (error) {
    storage.removeItem(key);
    return null;
  }
}

function writeSidebarCache(storage, userId, data, now = Date.now()) {
  if (!userId) return;
  const usage = {};
  for (const name of USAGE_COUNTS) {
    const value = data.usage?.[name];
    if (typeof value === "number" && Number.isFinite(value)) usage[name] = value;
  }
  const cache = {
    version: CACHE_VERSION,
    timestamp: now,
    userId,
    selectedUnitId: typeof data.selectedUnitId === "string" ? data.selectedUnitId : "",
    units: (data.units ?? []).map(({ id, name }) => ({ id, name })),
    conversations: (data.conversations ?? []).map(({ id, title }) => ({ id, title })),
    usage,
  };
  storage.setItem(sidebarCacheKey(userId), JSON.stringify(cache));
}

function clearSidebarCache(storage, userId) {
  if (userId) storage.removeItem(sidebarCacheKey(userId));
}

function isCurrentSidebarUnit(currentUnitId, requestedUnitId) {
  return currentUnitId === requestedUnitId;
}

module.exports = {
  CACHE_TTL_MS,
  sidebarCacheKey,
  readSidebarCache,
  writeSidebarCache,
  clearSidebarCache,
  isCurrentSidebarUnit,
};
