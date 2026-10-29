"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) { setError("Enter your email."); return; }
    const { error: authError } = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset` });
    if (authError) setError(authError.message);
    else { setError(""); setMessage("If that email is registered, a reset link is on its way."); }
  }
  return <main className="flex min-h-screen items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-xl">
    <h1 className="text-2xl font-semibold">Reset your password</h1>
    {error && <p role="alert" className="mt-3 rounded bg-red-950/70 px-3 py-2 text-sm text-red-100">{error}</p>}
    {message && <p className="mt-3 rounded bg-sky-950/70 px-3 py-2 text-sm text-sky-100">{message}</p>}
    <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="mt-5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" />
    <button className="mt-4 w-full rounded-lg bg-white py-2 font-semibold text-slate-950">Send reset link</button>
    <Link href="/login" className="mt-4 block text-center text-sm text-slate-300 hover:text-white">Back to sign in</Link>
  </form></main>;
}
