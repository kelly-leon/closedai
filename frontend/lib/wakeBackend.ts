const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export function wakeBackend(): void {
  if (typeof window === "undefined") return;
  let bannerShown = false;
  const timer = window.setTimeout(() => {
    bannerShown = true;
    window.dispatchEvent(new CustomEvent("closedai:server-waking", { detail: true }));
  }, 2000);
  void fetch(`${API_URL.replace(/\/$/, "")}/health`, { method: "GET", credentials: "omit", cache: "no-store" })
    .catch(() => undefined)
    .finally(() => {
      window.clearTimeout(timer);
      if (bannerShown) {
        window.dispatchEvent(new CustomEvent("closedai:server-waking", { detail: false }));
      }
    });
}
