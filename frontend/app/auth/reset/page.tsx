"use client";

import { FormEvent, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError("Choose a password of at least 8 characters."); return; }
    const { error: authError } = await supabase!.auth.updateUser({ password });
    if (authError) setError(authError.message);
    else { setError(""); setDone(true); }
  }
  return <main className="flex min-h-screen items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-xl">
    <h1 className="text-2xl font-semibold">Choose a new password</h1>
    {error && <p role="alert" className="mt-3 rounded bg-red-950/70 px-3 py-2 text-sm text-red-100">{error}</p>}
    {done && <p className="mt-3 rounded bg-emerald-950/70 px-3 py-2 text-sm text-emerald-100">Password updated. You can sign in now.</p>}
    <input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="New password" className="mt-5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" />
    <button className="mt-4 w-full rounded-lg bg-white py-2 font-semibold text-slate-950">Update password</button>
  </form></main>;
}
