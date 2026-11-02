"use client";

import Link from "next/link";
import { getLastChat } from "../lib/lastChat";

export function BackToChat({ className = "" }: { className?: string }) {
  const unitId = typeof window === "undefined" ? undefined : window.localStorage.getItem("closedai-unit-id") ?? undefined;
  const conversationId = getLastChat(unitId);
  return <Link href={conversationId ? `/chat/${conversationId}` : "/app"} className={className}>Back to chat</Link>;
}
