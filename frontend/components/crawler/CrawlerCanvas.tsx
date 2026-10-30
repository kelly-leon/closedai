"use client";

import { useEffect, useRef } from "react";
import { createCrawlerEngine } from "../../lib/crawler";

interface CrawlerCanvasProps {
  mode?: "ambient" | "search";
  words?: string[];
  className?: string;
}

export function CrawlerCanvas({ mode = "ambient", words = [], className = "" }: CrawlerCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const engine = createCrawlerEngine(canvas.current, { mode, words, reducedMotion: media.matches });
    return () => engine.destroy();
  }, [mode, words]);
  return <canvas ref={canvas} aria-hidden="true" className={`h-full w-full bg-[#05090b] ${className}`} />;
}
