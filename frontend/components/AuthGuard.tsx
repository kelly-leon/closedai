"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase, supabaseAuthEnabled } from "../lib/supabase";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(!supabaseAuthEnabled);
  const [signedIn, setSignedIn] = useState(false);
  const authPage = pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password" || pathname === "/auth/reset";
  const publicPage = pathname === "/" || pathname === "/privacy" || pathname === "/terms";

  useEffect(() => {
    if (!supabaseAuthEnabled || !supabase) { setSignedIn(false); setReady(true); return; }
    let active = true;
    const applySession = (hasSession: boolean) => {
      if (!active) return;
      setSignedIn(hasSession);
      setReady(true);
      if (!hasSession && !authPage && !publicPage) router.replace("/login");
      if (hasSession && (authPage || pathname === "/")) router.replace("/app");
    };
    void supabase.auth.getSession().then(({ data }) => applySession(Boolean(data.session)));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => applySession(Boolean(session)));
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [pathname, router, authPage, publicPage]);

  if (!ready && supabaseAuthEnabled) {
    return <div className="flex h-screen items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" /></div>;
  }
  if (supabaseAuthEnabled && ready && signedIn && (authPage || pathname === "/")) {
    return <div className="flex h-screen items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" /></div>;
  }
  if (supabaseAuthEnabled && authPage) return <>{children}</>;
  return <>{children}</>;
}
