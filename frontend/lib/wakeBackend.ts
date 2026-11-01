const SESSION_KEY = "closedai-backend-warmed";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function wakeBackend(): void {
  if (typeof window === "undefined" || window.sessionStorage.getItem(SESSION_KEY)) return;
  window.sessionStorage.setItem(SESSION_KEY, "1");
  void fetch(`${API_URL.replace(/\/$/, "")}/health`, { method: "GET", credentials: "omit" }).catch(() => undefined);
}
