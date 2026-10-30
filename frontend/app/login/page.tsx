"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    const { error: authError } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) setError(authError.message);
    else window.location.assign("/app");
  }
  async function google() {
    await supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/reset` } });
  }
  return <main className="flex min-h-screen items-center justify-center p-4">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl backdrop-blur-xl">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      {error && <p role="alert" className="mt-3 rounded bg-red-950/70 px-3 py-2 text-sm text-red-100">{error}</p>}
      <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="mt-5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" />
      <input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" className="mt-3 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" />
      <button disabled={busy} className="mt-4 w-full rounded-lg bg-white py-2 font-semibold text-slate-950">{busy ? "Signing in..." : "Sign in"}</button>
      {process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true" && <button type="button" onClick={() => void google()} className="mt-3 w-full rounded-lg border border-white/15 py-2">Continue with Google</button>}
      <div className="mt-4 flex justify-between text-sm text-slate-300"><Link href="/signup" className="hover:text-white">Create account</Link><Link href="/forgot-password" className="hover:text-white">Forgot password?</Link></div>
    </form>
  </main>;
}
