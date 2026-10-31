"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { Source } from "../lib/api";
import { parseCitations } from "../lib/messageText";

export function SourceList({ sources }: { sources: Source[] | null }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const openSource = (event: Event) => {
      const index = (event as CustomEvent<number>).detail;
      setOpen(true);
      setExpanded(index);
      window.setTimeout(() => refs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    };
    window.addEventListener("closedai:open-source", openSource);
    return () => window.removeEventListener("closedai:open-source", openSource);
  }, []);
  if (!sources?.length) return null;
  return <div className="mt-4 text-sm">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-[#e8ecf4] hover:bg-white/15">
      Sources ({sources.length})
    </button>
    {open && <div className="mt-2 space-y-2">
      {sources.map((source, index) => <div key={`${source.filename}-${source.page}-${index}`} ref={element => { refs.current[index] = element; }} className="rounded-lg bg-white/5 px-3 py-2">
        <button type="button" onClick={() => setExpanded(expanded === index ? null : index)} className="w-full text-left text-slate-200 hover:text-white">
          {source.filename}{source.page !== null ? ` · page ${source.page}` : ""}
        </button>
        {expanded === index && <p className="mt-2 text-xs leading-relaxed text-slate-300">{source.snippet}</p>}
      </div>)}
    </div>}
  </div>;
}

export function inlineSources(text: string, sources: Source[] | null): ReactNode[] {
  if (!sources?.length) return [text];
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const citation of parseCitations(text)) {
    if (citation.start > lastIndex) parts.push(text.slice(lastIndex, citation.start));
    const { filename, page } = citation;
    const sourceIndex = filename
      ? sources.findIndex(source => source.filename === filename && source.page === page)
      : sources.findIndex(source => source.page === page);
    const key = `${citation.start}-${filename ?? "page"}-${page}`;
    parts.push(<button key={key} type="button" onClick={() => window.dispatchEvent(new CustomEvent("closedai:open-source", { detail: Math.max(sourceIndex, 0) }))} className="mx-0.5 inline-flex translate-y-[-1px] rounded-full bg-blue-400/15 px-2 py-0.5 text-xs font-medium text-blue-200 hover:bg-blue-400/25">Source {Math.max(sourceIndex, 0) + 1}</button>);
    lastIndex = citation.end;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
