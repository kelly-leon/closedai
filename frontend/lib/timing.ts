type TimingStatus = number | string | undefined;

function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1"
    || ["1", "true"].includes(window.localStorage.getItem("closedai-debug")?.toLowerCase() ?? "");
}

export function timingStart(name: string): (status?: TimingStatus, retries?: number) => void {
  const started = performance.now();
  if (debugEnabled()) console.info("[ClosedAI timing]", { name, event: "start" });
  return (status, retries = 0) => {
    if (debugEnabled()) {
      console.info("[ClosedAI timing]", {
        name,
        event: "end",
        ms: Math.round(performance.now() - started),
        status,
        retries,
      });
    }
  };
}

export function timingEvent(name: string, event: "retry", status?: TimingStatus, retries = 0): void {
  if (debugEnabled()) console.info("[ClosedAI timing]", { name, event, status, retries });
}
