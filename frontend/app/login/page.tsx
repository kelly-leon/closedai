"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "../../components/auth/AuthShell";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
  return <AuthShell><form onSubmit={submit} className="auth-form" noValidate>
    <p className="auth-eyebrow">Welcome back</p>
    <h1>Sign in to<br />ClosedAI.</h1>
    {error && <p role="alert" className="auth-message auth-error">Error: {error}</p>}
    <div className="auth-field">
      <input id="login-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder=" " autoComplete="email" />
      <label htmlFor="login-email">Email address</label>
    </div>
    <div className="auth-field auth-password-field">
      <input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder=" " autoComplete="current-password" />
      <label htmlFor="login-password">Password</label>
      <button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
    </div>
    <button disabled={busy} className="auth-primary">{busy ? "Signing in..." : "Sign in"}<span aria-hidden="true">↗</span></button>
    {process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true" && <button type="button" onClick={() => void google()} className="auth-text-action google-action">Continue with Google</button>}
    <div className="auth-secondary"><Link href="/signup">Create account</Link><Link href="/forgot-password">Forgot password?</Link></div>
  </form></AuthShell>;
}
