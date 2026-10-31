export function crawlerOverlayVisible(currentlyVisible, eventName) {
  if (eventName === "token" || eventName === "error" || eventName === "done") return false;
  return currentlyVisible;
}
