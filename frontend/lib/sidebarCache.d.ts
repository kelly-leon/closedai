export interface SidebarCache {
  version: number;
  timestamp: number;
  userId: string;
  selectedUnitId: string;
  units: Array<{ id: string; name: string }>;
  conversations: Array<{ id: string; title: string }>;
  usage: Record<string, number>;
}

export function sidebarCacheKey(userId: string): string;
export function readSidebarCache(storage: Storage, userId: string, now?: number): SidebarCache | null;
export function writeSidebarCache(
  storage: Storage,
  userId: string,
  data: {
    selectedUnitId?: string;
    units?: Array<{ id: string; name: string }>;
    conversations?: Array<{ id: string; title: string }>;
    usage?: object | null;
  },
  now?: number,
): void;
export function clearSidebarCache(storage: Storage, userId: string): void;
export function isCurrentSidebarUnit(currentUnitId: string, requestedUnitId: string): boolean;
export const CACHE_TTL_MS: number;
