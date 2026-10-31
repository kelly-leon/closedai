"use client";

import { useEffect, useRef } from "react";
import { createCrawlerEngine, CrawlerStatus } from "../../lib/crawler";

interface CrawlerCanvasProps {
  mode?: "ambient" | "search";
  words?: string[];
  documents?: string[];
  status?: CrawlerStatus;
  className?: string;
}

export function CrawlerCanvas({ mode = "ambient", words = [], documents = [], status, className = "" }: CrawlerCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    if (process.env.NEXT_PUBLIC_CRAWLER === "off") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const engine = createCrawlerEngine(canvas.current, { mode, words, documents, status, reducedMotion: media.matches });
    return () => engine.destroy();
  }, [mode, words, documents, status]);
  return <canvas ref={canvas} aria-hidden="true" className={`h-full w-full bg-[#05090b] ${className}`} />;
}
