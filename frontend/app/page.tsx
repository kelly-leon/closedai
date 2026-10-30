"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Chat } from "../components/Chat";
import { BILLING_PACKAGES } from "../lib/packages";
import { supabaseAuthEnabled } from "../lib/supabase";

export default function Home() {
  if (!supabaseAuthEnabled) return <Chat />;
  return <HostedHome />;
}

function HostedHome() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      setReady(true);
    });
    return () => { active = false; };
  }, []);
  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-slate-950"><div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-sky-300 motion-reduce:animate-none" /></div>;
  return <LandingPage signedIn={signedIn} />;
}

function LandingPage({ signedIn }: { signedIn: boolean }) {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
  const github = process.env.NEXT_PUBLIC_GITHUB_URL ?? "";
  const bestValue = BILLING_PACKAGES.filter(item => item.tokens).sort((a, b) => ((b.tokens ?? 0) / b.priceKsh) - ((a.tokens ?? 0) / a.priceKsh))[0];
  return <div className="min-h-screen bg-slate-950 text-white">
    <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="text-xl font-bold">ClosedAI</Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-slate-200 md:flex"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav>
        <div className="flex items-center gap-2">{signedIn ? <Link href="/app" className="rounded-lg bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950">Open app</Link> : <><Link href="/login" className="px-3 py-2 text-sm">Log in</Link><Link href="/signup" className="rounded-lg bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950">Start free</Link></>}</div>
      </div>
    </header>
    <main>
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-20 text-center md:pt-28">
        <h1 className="text-5xl font-bold leading-tight md:text-7xl">Study smarter from your own notes</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-200 md:text-xl">Ask questions across lecture slides, notes and past papers—and get clear, cited answers grounded in your files.</p>
        <Link href={signedIn ? "/app" : "/signup"} className="mt-8 inline-block rounded-xl bg-sky-300 px-6 py-3 font-semibold text-slate-950">{signedIn ? "Open app" : "Start free"}</Link>
        <p className="mt-3 text-sm text-slate-300">Free trial. No card needed.</p>
      </section>
      <section id="features" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-semibold">Built for your courses</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">{[
          ["Course units", "Organize notes, slides and papers into a unit per course."],
          ["Cited answers", "Follow answers to the exact page and source file."],
          ["Any study file", "Upload PDF, DOCX, TXT and MD documents."],
          ["Private by default", "Your documents and conversations stay scoped to you."],
          ["M-Pesa billing", "Add tokens simply with manual M-Pesa payment approval."],
        ].map(([title, text]) => <article key={title} className="rounded-2xl border border-white/10 bg-slate-900/70 p-6"><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-slate-300">{text}</p></article>)}</div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-16"><h2 className="text-3xl font-semibold">How it works</h2><ol className="mt-8 grid gap-4 md:grid-cols-3">{["Upload your notes", "Ask questions", "Get cited answers"].map((step, index) => <li key={step} className="rounded-2xl border border-white/10 bg-slate-900/70 p-6"><span className="text-sky-300">0{index + 1}</span><h3 className="mt-3 text-xl font-semibold">{step}</h3></li>)}</ol></section>
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16"><h2 className="text-3xl font-semibold">Simple pricing</h2><p className="mt-3 text-slate-300">Free trial: 100 tokens each week and 3 documents. Each message uses 5 tokens.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">{BILLING_PACKAGES.map(pkg => <article key={pkg.priceKsh} className="relative rounded-2xl border border-white/10 bg-slate-900/70 p-6"><p className="text-sm text-slate-300">M-Pesa package</p><h3 className="mt-2 text-3xl font-bold">KSh {pkg.priceKsh}</h3><p className="mt-3">{pkg.tokens ? `${pkg.tokens.toLocaleString()} tokens` : "3 months premium"}</p><p className="mt-1 text-slate-300">{pkg.tokens ? `${Math.floor(pkg.tokens / 5).toLocaleString()} messages` : "Premium answers with a daily limit"}</p>{bestValue?.priceKsh === pkg.priceKsh && <span className="absolute right-4 top-4 rounded-full bg-sky-300 px-2 py-1 text-xs font-bold text-slate-950">Best value</span>}<Link href={signedIn ? "/app" : "/signup"} className="mt-5 inline-block rounded-lg bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950">{signedIn ? "Open app" : "Get started"}</Link></article>)}</div>
      </section>
      <section id="faq" className="mx-auto max-w-4xl px-5 py-16"><h2 className="text-3xl font-semibold">FAQ</h2><div className="mt-6 space-y-3">
        {[["How do tokens work?", "A completed chat answer uses 5 tokens. Your free weekly allowance is 100 tokens, then purchased tokens are used."], ["How does M-Pesa payment work?", "Pay the exact package amount, submit its transaction code, and allow 30 to 60 minutes for verification and the token award."], ["Are my uploads private?", "Your files are not used to train ClosedAI models. You should review the draft privacy terms for provider processing and deletion details."], ["Which files are supported?", "PDF, DOCX, TXT and Markdown files up to the app's configured size limit are supported."], ["What about scanned PDFs?", "Scanned documents without extractable text are not supported yet. Please upload text-based PDFs or another supported format."]].map(([q, a]) => <details key={q} className="rounded-xl border border-white/10 bg-slate-900/70 p-5"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-3 text-slate-300">{a}</p></details>)}
      </div></section>
    </main>
    <footer className="border-t border-white/10"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-5 py-8 text-sm text-slate-300"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>{contact && <a href={`mailto:${contact}`}>{contact}</a>}{github && <a href={github} target="_blank" rel="noreferrer">GitHub</a>}</div></footer>
  </div>;
}
