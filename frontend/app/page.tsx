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
  const [activeDemo, setActiveDemo] = useState("Ask");
  const demos: Record<string, { note: string; detail: string }> = {
    Ask: { note: "What explains recursive descent parsing?", detail: "An answer drawn from your lecture notes, with the source attached." },
    Cite: { note: "Recursive descent parses top-down...", detail: "Every claim links back to the exact page and passage." },
    Organize: { note: "Data Structures / Week 07", detail: "Keep readings, slides, and past papers grouped by unit." },
    Review: { note: "Topics I should revisit", detail: "Turn your course material into a focused study checklist." },
  };
  return (
    <div className="landing-page relative min-h-screen overflow-hidden text-white">
      <CrawlerCanvas mode="ambient" className="pointer-events-none fixed inset-0 z-0" />
      <header className="landing-header sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" className="landing-wordmark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b9ff66]">ClosedAI</Link>
          <nav aria-label="Primary" className="hidden items-center gap-8 text-sm text-[#d9d4dc] md:flex">
            <a href="#what" className="nav-link">What it does</a>
            <a href="#how" className="nav-link">How it works</a>
            <a href="#faq" className="nav-link">FAQ</a>
          </nav>
          <div className="flex items-center gap-4 text-sm md:gap-6">
            {!signedIn && <Link href="/login" className="nav-link hidden sm:block">Log in</Link>}
            <Link href={destination} className="landing-button">{action}<span aria-hidden="true">↗</span></Link>
          </div>
        </div>
      </header>
      <main className="relative z-10">
        <section className="hero mx-auto flex min-h-[760px] max-w-[1240px] flex-col justify-center px-5 py-24 md:px-8 md:py-32">
          <div className="max-w-[980px]">
            <p className="hero-kicker">Your course, finally connected</p>
            <h1>Answers <em>from</em><br />your own notes.</h1>
            <p className="hero-copy">Ask across lectures, readings and past papers—and get an answer you can trace.</p>
          </div>
          <div className="hero-question" role="search">
            <span>Ask your files</span>
            <p>Why do recursive descent parsers work top-down?</p>
            <span aria-hidden="true" className="question-arrow">↗</span>
          </div>
        </section>
        <section id="what" className="landing-section mx-auto max-w-[1240px] px-5 md:px-8">
          <p className="section-label">What it does</p>
          <h2 className="sr-only">What ClosedAI does</h2>
          <div className="statement-grid">
            <p><strong>Cited answers.</strong><span>Follow every claim back to the source page.</span></p>
            <p><strong>Units per course.</strong><span>Keep each class and semester in its own place.</span></p>
            <p><strong>Your files stay private.</strong><span>Documents belong to you, not the open web.</span></p>
            <p><strong>PDF, DOCX, TXT, MD.</strong><span>Bring the formats already in your study folder.</span></p>
          </div>
        </section>
        <section className="landing-section mx-auto max-w-[1240px] px-5 md:px-8" aria-labelledby="demo-title">
          <div className="demo-heading">
            <div>
              <p className="section-label">One reading companion</p>
              <h2 id="demo-title">From question<br />to understanding.</h2>
            </div>
            <div className="demo-tabs" role="tablist" aria-label="Product demo">
              {Object.keys(demos).map((tab) => (
                <button key={tab} role="tab" aria-selected={activeDemo === tab} className={activeDemo === tab ? "active" : ""} onClick={() => setActiveDemo(tab)}>{tab}</button>
              ))}
            </div>
          </div>
          <div className="demo-stage" role="tabpanel">
            <div className={`demo-art art-${activeDemo.toLowerCase()}`} aria-hidden="true">
              <span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit-dot" />
              <div className="document-note"><span>{activeDemo}</span><p>{demos[activeDemo].note}</p></div>
            </div>
            <p>{demos[activeDemo].detail}</p>
          </div>
        </section>
        <section id="how" className="landing-section mx-auto max-w-[1240px] px-5 md:px-8">
          <p className="section-label">How it works</p>
          <ol className="steps">
            {[["01", "Add", "Upload your notes, slides, readings and papers to a course unit."], ["02", "Ask", "Search across the material in your own words."], ["03", "Follow", "Read a clear answer and open the exact source behind it."]].map(([number, title, text]) => (
              <li key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></li>
            ))}
          </ol>
        </section>
        <section id="faq" className="landing-section faq-section mx-auto max-w-[1240px] px-5 md:px-8">
          <p className="section-label">FAQ</p>
          <h2>Common questions.</h2>
          <div className="faq-list">
            {[["Are my files private?", "Your documents and conversations are scoped to your account and are private by default. AI providers process relevant text only when generating an answer."], ["Which file types can I upload?", "You can upload PDF, DOCX, TXT and Markdown files."], ["Can ClosedAI read scanned files?", "Text-based PDFs work directly. Scanned PDFs depend on whether the pages contain searchable text or clear OCR output."]].map(([q, a]) => (
              <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>
            ))}
          </div>
        </section>
      </main>
      <footer className="landing-footer relative z-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-10 px-5 py-16 md:px-8">
          <Link href="/" className="footer-wordmark">ClosedAI</Link>
          <nav aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          {contact && <a href={`mailto:${contact}`} className="hover:text-white">Contact</a>}
          {github && <a href={github} target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>}
          </nav>
        </div>
      </footer>
    </div>
  );
}
