"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase, supabaseAuthEnabled } from "../lib/supabase";

const CrawlerCanvas = dynamic(() => import("../components/crawler/CrawlerCanvas").then(module => module.CrawlerCanvas), { ssr: false });

export default function Home() {
  if (!supabaseAuthEnabled) return <LandingPage signedIn={false} />;
  return <HostedHome />;
}

function HostedHome() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) { setSignedIn(Boolean(data.session)); setReady(true); }
    });
    return () => { active = false; };
  }, []);
  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading ClosedAI…</div>;
  return <LandingPage signedIn={signedIn} />;
}

function LandingPage({ signedIn }: { signedIn: boolean }) {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
  const github = process.env.NEXT_PUBLIC_GITHUB_URL ?? "";
  const action = signedIn ? "Open app" : "Get started";
  const destination = signedIn ? "/app" : "/signup";
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05090b] text-white">
      <CrawlerCanvas mode="ambient" className="pointer-events-none fixed inset-0 z-0" />
      <header className="relative z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Link href="/" className="text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">ClosedAI</Link>
          <nav aria-label="Primary" className="hidden gap-7 text-sm text-slate-200 md:flex">
            <a href="#what" className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">What it does</a>
            <a href="#faq" className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">FAQ</a>
          </nav>
          <div className="flex items-center gap-5 text-sm">
            {!signedIn && <Link href="/login" className="hover:text-sky-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">Log in</Link>}
            <Link href={destination} className="font-semibold text-sky-300 hover:text-pink-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">{action} →</Link>
          </div>
        </div>
      </header>
      <main className="relative z-10">
        <section className="mx-auto max-w-6xl px-5 pb-24 pt-24 md:pt-32">
          <div className="max-w-3xl bg-gradient-to-r from-[#05090b]/95 via-[#05090b]/75 to-transparent py-5">
            <h1 className="text-5xl font-bold leading-[0.95] md:text-7xl">Ask your whole course.</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-200 md:text-xl">Search notes, slides and past papers in one place. ClosedAI answers from your files and cites the exact page.</p>
            <Link href={destination} className="mt-9 inline-block text-xl font-semibold text-sky-300 hover:text-pink-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">{action} →</Link>
          </div>
        </section>
        <section id="what" className="mx-auto max-w-6xl px-5 py-24">
          <div className="max-w-3xl bg-gradient-to-r from-[#05090b]/95 to-transparent py-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-pink-200">What it does</p>
            <h2 className="mt-4 text-4xl font-bold md:text-5xl">A private reading companion for everything you study.</h2>
            <p className="mt-6 text-lg leading-8 text-slate-200">Organize files into units per course, ask across your notes or one past paper, and follow every answer to its exact source page.</p>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-24">
          <h2 className="text-4xl font-bold">How it works</h2>
          <ol className="mt-12 grid max-w-4xl gap-12 md:grid-cols-3">
            {[["01", "Upload", "Add notes, slides or past papers to a course unit."], ["02", "Ask", "Ask in your own words across the files you chose."], ["03", "Get cited answers", "Read a clear answer, then open the exact cited page."]].map(([number, title, text]) => (
              <li key={number}><span className="text-pink-200">{number}</span><h3 className="mt-3 text-2xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-slate-300">{text}</p></li>
            ))}
          </ol>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-24">
          <div className="bg-gradient-to-r from-[#05090b]/95 to-transparent py-4">
            <h2 className="text-4xl font-bold">Bring your study files</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">ClosedAI supports PDF, DOCX, TXT and Markdown. Files stay private to you by default.</p>
          </div>
        </section>
        <section id="faq" className="mx-auto max-w-4xl px-5 py-24">
          <h2 className="text-4xl font-bold">FAQ</h2>
          <div className="mt-10 space-y-8">
            {[["Are my files private?", "Your documents and conversations are scoped to your account and are private by default. AI providers process relevant text only when generating an answer."], ["Which file types can I upload?", "You can upload PDF, DOCX, TXT and Markdown files."]].map(([q, a]) => (
              <details key={q}><summary className="cursor-pointer text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">{q}</summary><p className="mt-3 max-w-2xl leading-7 text-slate-300">{a}</p></details>
            ))}
          </div>
        </section>
      </main>
      <footer className="relative z-10">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-7 px-5 py-10 text-sm text-slate-300">
          <Link href="/privacy" className="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">Privacy</Link>
          <Link href="/terms" className="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300">Terms</Link>
          {contact && <a href={`mailto:${contact}`} className="hover:text-white">Contact</a>}
          {github && <a href={github} target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>}
        </div>
      </footer>
    </div>
  );
}
