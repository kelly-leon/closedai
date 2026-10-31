"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { AuthShell } from "../../../components/auth/AuthShell";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.has("error") || ["expired", "access_denied"].includes(hash.get("error_code") ?? "")) {
      setInvalidLink(true);
      setReady(true);
      return;
    }

    const markReady = () => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      setReady(true);
    };
    void supabase!.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
      else timer = setTimeout(() => {
        if (active) { setInvalidLink(true); setReady(true); }
      }, 8000);
    });
    const { data: subscription } = supabase!.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) markReady();
      if (event === "SIGNED_OUT" && active) {
        setInvalidLink(true);
        setReady(true);
      }
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("Choose a password of at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setSaving(true);
    const { error: authError } = await supabase!.auth.updateUser({ password });
    setSaving(false);
    if (authError) setError(authError.message);
    else {
      try { await supabase!.auth.signOut({ scope: "others" }); } catch {}
      setDone(true);
      window.setTimeout(() => window.location.assign("/login?reset=success"), 500);
    }
  }
  if (!ready) return <AuthShell><div className="auth-form" role="status">
    <p className="auth-eyebrow">Account access</p>
    <h1>Checking your<br />link.</h1>
  </div></AuthShell>;
  if (invalidLink) return <AuthShell><div className="auth-form">
    <p className="auth-eyebrow">Account access</p>
    <h1>Link unavailable.</h1>
    <p className="auth-message auth-error">This link has expired or was opened in a different browser. Request a new one.</p>
    <Link href="/forgot-password" className="auth-primary">Request a new link<span aria-hidden="true">↗</span></Link>
  </div></AuthShell>;
  return <AuthShell><form onSubmit={submit} className="auth-form" noValidate>
    <p className="auth-eyebrow">Account access</p>
    <h1>Choose a new<br />password.</h1>
    {error && <p role="alert" className="auth-message auth-error">Error: {error}</p>}
    {done && <p role="status" className="auth-message auth-success">Password updated. You can sign in now.</p>}
    <div className="auth-field auth-password-field"><input id="reset-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder=" " autoComplete="new-password" /><label htmlFor="reset-password">New password</label><button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></div>
    <div className="auth-field"><input id="reset-confirm" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder=" " autoComplete="new-password" /><label htmlFor="reset-confirm">Confirm new password</label></div>
    <button disabled={saving} className="auth-primary">{saving ? "Updating..." : "Update password"}<span aria-hidden="true">↗</span></button>
  </form></AuthShell>;
}
