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

  useEffect(() => {
    if (!supabaseAuthEnabled || !supabase) { setReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const authenticated = Boolean(data.session);
      setSignedIn(authenticated);
      setReady(true);
      if (!authenticated && !authPage) router.replace("/login");
      if (authenticated && pathname === "/login") router.replace("/");
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      if (!session && !authPage) router.replace("/login");
      if (session && pathname === "/login") router.replace("/");
    });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [pathname, router, authPage]);

  if (!ready && (supabaseAuthEnabled || signedIn)) {
    return <div className="flex h-screen items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" /></div>;
  }
  if (supabaseAuthEnabled && authPage) return <>{children}</>;
  return <>{children}</>;
}
