"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "../../components/auth/AuthShell";

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
  return <AuthShell><form onSubmit={submit} className="auth-form" noValidate>
    <p className="auth-eyebrow">Account access</p>
    <h1>Reset your<br />password.</h1>
    {error && <p role="alert" className="auth-message auth-error">Error: {error}</p>}
    {message && <p role="status" className="auth-message auth-success">{message}</p>}
    <div className="auth-field"><input id="forgot-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder=" " autoComplete="email" /><label htmlFor="forgot-email">Email address</label></div>
    <button className="auth-primary">Send reset link<span aria-hidden="true">↗</span></button>
    <div className="auth-secondary auth-secondary-centered"><Link href="/login">Back to sign in</Link></div>
  </form></AuthShell>;
}
