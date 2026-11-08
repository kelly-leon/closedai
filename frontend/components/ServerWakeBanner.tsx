"use client";

import { useEffect, useState } from "react";
import { SERVER_WAKE_MESSAGE } from "../lib/api";
import { BrandLoader } from "./BrandLoader";

export function ServerWakeBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setVisible(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("closedai:server-waking", update);
    return () => window.removeEventListener("closedai:server-waking", update);
  }, []);
  if (!visible) return null;
  return <div role="status" className="fixed inset-x-0 top-3 z-[100] mx-auto flex w-fit items-center gap-3 rounded-xl border border-sky-300/20 bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-xl">
    <BrandLoader className="brand-loader-small" />
    <span>{SERVER_WAKE_MESSAGE}</span>
  </div>;
}
