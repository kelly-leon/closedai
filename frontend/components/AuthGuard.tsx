"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase, supabaseAuthEnabled } from "../lib/supabase";
import { BrandLoader } from "./BrandLoader";

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
    const applySession = (session: { user?: { id: string } } | null) => {
      const hasSession = Boolean(session);
      if (hasSession && session?.user?.id) {
        const previousUser = window.localStorage.getItem("closedai-user-id");
        if (previousUser && previousUser !== session.user.id) {
          window.localStorage.removeItem("closedai-unit-id");
          sessionStorage.removeItem("closedai-last-chat");
        }
        window.localStorage.setItem("closedai-user-id", session.user.id);
      }
      if (!active) return;
      setSignedIn(hasSession);
      setReady(true);
      if (!hasSession && !authPage && !publicPage) router.replace("/login");
      if (hasSession && authPage && pathname !== "/auth/reset") router.replace("/app");
    };
    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [pathname, router, authPage, publicPage]);

  if (!ready && supabaseAuthEnabled) {
    return <div className="flex h-screen items-center justify-center"><BrandLoader /></div>;
  }
  if (supabaseAuthEnabled && ready && signedIn && authPage) {
    return <div className="flex h-screen items-center justify-center"><BrandLoader /></div>;
  }
  if (supabaseAuthEnabled && authPage) return <>{children}</>;
  return <>{children}</>;
}
