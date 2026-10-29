"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim() || password.length < 8) { setError("Use a valid email and a password of at least 8 characters."); return; }
    const { error: authError } = await supabase!.auth.signUp({ email: email.trim(), password });
    if (authError) setError(authError.message);
    else setMessage("Check your email to confirm your account.");
  }
  return <main className="flex min-h-screen items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-xl">
    <h1 className="text-2xl font-semibold">Create your account</h1>
    {error && <p role="alert" className="mt-3 rounded bg-red-950/70 px-3 py-2 text-sm text-red-100">{error}</p>}
    {message && <p className="mt-3 rounded bg-emerald-950/70 px-3 py-2 text-sm text-emerald-100">{message}</p>}
    <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="mt-5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" />
    <input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password (8+ characters)" className="mt-3 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" />
    <button className="mt-4 w-full rounded-lg bg-white py-2 font-semibold text-slate-950">Create account</button>
    <Link href="/login" className="mt-4 block text-center text-sm text-slate-300 hover:text-white">Already have an account? Sign in</Link>
  </form></main>;
}
