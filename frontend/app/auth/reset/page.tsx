"use client";

import { FormEvent, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { AuthShell } from "../../../components/auth/AuthShell";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError("Choose a password of at least 8 characters."); return; }
    const { error: authError } = await supabase!.auth.updateUser({ password });
    if (authError) setError(authError.message);
    else { setError(""); setDone(true); }
  }
  return <AuthShell><form onSubmit={submit} className="auth-form" noValidate>
    <p className="auth-eyebrow">Account access</p>
    <h1>Choose a new<br />password.</h1>
    {error && <p role="alert" className="auth-message auth-error">Error: {error}</p>}
    {done && <p role="status" className="auth-message auth-success">Password updated. You can sign in now.</p>}
    <div className="auth-field auth-password-field"><input id="reset-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder=" " autoComplete="new-password" /><label htmlFor="reset-password">New password</label><button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></div>
    <button className="auth-primary">Update password<span aria-hidden="true">↗</span></button>
  </form></AuthShell>;
}
