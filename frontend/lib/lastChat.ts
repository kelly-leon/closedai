export function storeLastChat(conversationId: string, unitId: string) {
  sessionStorage.setItem("closedai-last-chat", JSON.stringify({ conversationId, unitId }));
}

export function clearLastChat() {
  sessionStorage.removeItem("closedai-last-chat");
}

export function getLastChat(unitId?: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem("closedai-last-chat") ?? "null") as { conversationId?: string; unitId?: string } | null;
    if (!value?.conversationId || (unitId && value.unitId !== unitId)) return null;
    return value.conversationId;
  } catch {
    return null;
  }
}
