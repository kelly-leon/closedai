"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase, supabaseAuthEnabled } from "../lib/supabase";
import { BrandLoader } from "./BrandLoader";
import { clearSidebarCache } from "../lib/sidebarCache";
import { wakeBackend } from "../lib/wakeBackend";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(!supabaseAuthEnabled);
  const [signedIn, setSignedIn] = useState(false);
  const [sessionTimedOut, setSessionTimedOut] = useState(false);
  const warmedUser = useRef("");
  const authPage = pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password" || pathname === "/auth/reset";
  const publicPage = pathname === "/" || pathname === "/privacy" || pathname === "/terms";

  useEffect(() => {
    if (!supabaseAuthEnabled || !supabase) { setSignedIn(false); setReady(true); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setSessionTimedOut(true);
      setReady(true);
    }, 8000);
    const applySession = (session: { user?: { id: string } } | null) => {
      const hasSession = Boolean(session);
      if (hasSession && session?.user?.id) {
        const previousUser = window.localStorage.getItem("closedai-user-id");
        if (previousUser && previousUser !== session.user.id) {
          clearSidebarCache(window.localStorage, previousUser);
          window.localStorage.removeItem("closedai-unit-id");
          sessionStorage.removeItem("closedai-last-chat");
          window.dispatchEvent(new CustomEvent("closedai:user-changed"));
        }
        window.localStorage.setItem("closedai-user-id", session.user.id);
        if (warmedUser.current !== session.user.id) {
          warmedUser.current = session.user.id;
          wakeBackend();
        }
      } else {
        const previousUser = window.localStorage.getItem("closedai-user-id");
        if (previousUser) clearSidebarCache(window.localStorage, previousUser);
        window.localStorage.removeItem("closedai-user-id");
        window.localStorage.removeItem("closedai-unit-id");
        sessionStorage.removeItem("closedai-last-chat");
        window.dispatchEvent(new CustomEvent("closedai:signed-out"));
      }
      if (!active) return;
      window.clearTimeout(timer);
      setSessionTimedOut(false);
      setSignedIn(hasSession);
      setReady(true);
      if (!hasSession && !authPage && !publicPage) router.replace("/login");
      if (hasSession && authPage && pathname !== "/auth/reset") router.replace("/app");
    };
    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    return () => { active = false; window.clearTimeout(timer); subscription.subscription.unsubscribe(); };
  }, [pathname, router, authPage, publicPage]);

  if (sessionTimedOut) {
    return <main role="status" className="flex h-screen items-center justify-center bg-slate-950 px-5 text-center text-white">
      <div><p>We couldn’t check your session. Please retry.</p><button type="button" className="mt-4 rounded-lg bg-sky-300 px-4 py-2 font-semibold text-slate-950" onClick={() => window.location.reload()}>Retry</button></div>
    </main>;
  }
  if (!ready && supabaseAuthEnabled) {
    return <div className="flex h-screen items-center justify-center"><BrandLoader /></div>;
  }
  if (supabaseAuthEnabled && ready && signedIn && authPage) {
    return <div className="flex h-screen items-center justify-center"><BrandLoader /></div>;
  }
  if (supabaseAuthEnabled && authPage) return <>{children}</>;
  return <>{children}</>;
}
