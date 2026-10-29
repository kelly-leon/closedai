"use client";

import { useEffect, useRef, useState } from "react";

const THINKING_WORDS = [
  "Triangulating",
  "Mulling",
  "Crawling",
  "Digging",
  "Cross-referencing",
  "Sifting",
  "Connecting dots",
  "Ruminating",
  "Scouring",
  "Untangling",
  "Decoding",
  "Cogitating",
  "Foraging",
  "Piecing together",
  "Surfacing",
];

export function ThinkingIndicator({ status }: { status?: string }) {
  const [word, setWord] = useState(THINKING_WORDS[0]);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const wordRef = useRef(word);
  const fadeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = window.setInterval(() => {
      setVisible(false);
      fadeTimeoutRef.current = window.setTimeout(() => {
        let next = wordRef.current;
        while (next === wordRef.current) {
          next = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
        }
        wordRef.current = next;
        setWord(next);
        setVisible(true);
      }, 180);
    }, 2000);
    return () => {
      window.clearInterval(interval);
      if (fadeTimeoutRef.current !== null) window.clearTimeout(fadeTimeoutRef.current);
    };
  }, [reducedMotion]);

  return (
    <div
      aria-live="polite"
      aria-label="Assistant is working"
      className="flex items-center gap-2 text-sm text-[#a9b3c7]"
    >
      <span className="sr-only">Assistant is working</span>
      <span
        aria-hidden="true"
        className={`transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      >
        {status ?? word}
      </span>
      {!reducedMotion && (
        <span aria-hidden="true" className="inline-flex gap-0.5" role="presentation">
          <span className="animate-pulse">.</span>
          <span className="animate-pulse [animation-delay:150ms]">.</span>
          <span className="animate-pulse [animation-delay:300ms]">.</span>
        </span>
      )}
    </div>
  );
}
