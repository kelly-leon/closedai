"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "../../components/auth/AuthShell";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (fullName.trim().length < 2 || fullName.trim().length > 60) { setError("Enter your full name using 2 to 60 characters."); return; }
    if (!email.trim()) { setError("Enter your email address."); return; }
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    const { data, error: authError } = await supabase!.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    if (authError) setError(authError.message || "We couldn't create your account. Please try again.");
    else if (data.user && !data.session) setMessage("Check your email and confirm your address before signing in.");
    else setMessage("Check your email to confirm your account.");
  }
  async function google() {
    await supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/app` } });
  }
  return <AuthShell><form onSubmit={submit} className="auth-form" noValidate>
    <p className="auth-eyebrow">Start here</p>
    <h1>Create your<br />account.</h1>
    {error && <p role="alert" className="auth-message auth-error">Error: {error}</p>}
    {message && <p role="status" className="auth-message auth-success">{message}</p>}
    <div className="auth-field"><input id="signup-name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder=" " required minLength={2} maxLength={60} autoComplete="name" /><label htmlFor="signup-name">Full name</label></div>
    <div className="auth-field"><input id="signup-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder=" " autoComplete="email" /><label htmlFor="signup-email">Email address</label></div>
    <div className="auth-field auth-password-field"><input id="signup-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder=" " autoComplete="new-password" /><label htmlFor="signup-password">Password (8+ characters)</label><button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></div>
    <div className="auth-field"><input id="signup-confirm" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder=" " autoComplete="new-password" /><label htmlFor="signup-confirm">Confirm password</label></div>
    <button className="auth-primary">Create account<span aria-hidden="true">↗</span></button>
    {process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true" && <button type="button" onClick={() => void google()} className="auth-text-action google-action">Continue with Google</button>}
    <div className="auth-secondary auth-secondary-centered"><Link href="/login">Already have an account? Sign in</Link></div>
  </form></AuthShell>;
}
