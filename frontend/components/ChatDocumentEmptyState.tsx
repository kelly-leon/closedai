"use client";

import Link from "next/link";
import { DragEvent, useEffect, useState } from "react";
import { BrandLoader } from "./BrandLoader";
import { useDocumentUploader } from "../hooks/useDocumentUploader";
import { documentEmptyState } from "../lib/documentEmptyState";

export function ChatDocumentEmptyState({ onReady }: { onReady: () => void }) {
  const [unitId, setUnitId] = useState("");
  const [dragging, setDragging] = useState(false);
  const uploader = useDocumentUploader(unitId);

  useEffect(() => {
    setUnitId(window.localStorage.getItem("closedai-unit-id") ?? "");
    const refresh = (event: Event) => setUnitId((event as CustomEvent<string>).detail);
    window.addEventListener("closedai:unit-changed", refresh);
    return () => window.removeEventListener("closedai:unit-changed", refresh);
  }, []);

  useEffect(() => {
    if (uploader.documents.some(document => document.status === "ready")) onReady();
  }, [uploader.documents, onReady]);

  const queryStatus = uploader.loading ? "loading" : uploader.loadError ? "error" : "success";
  const state = documentEmptyState(uploader.documents, queryStatus);
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void uploader.upload(Array.from(event.dataTransfer.files));
  }

  if (state === "loading") return <div className="flex min-h-[240px] items-center justify-center"><BrandLoader /></div>;
  if (state === "failed") return <div role="alert" className="py-16 text-center"><p className="text-lg">We couldn't load your documents.</p><button type="button" onClick={() => void uploader.load(true)} className="mt-4 rounded-lg bg-white px-4 py-2 font-semibold text-slate-950">Retry</button></div>;
  if (state === "has-ready") return null;

  const processing = uploader.documents.filter(document => document.status === "pending" || document.status === "processing");
  const done = uploader.documents.filter(document => document.status === "ready");
  const failed = uploader.documents.filter(document => document.status === "failed");
  const sectionsDone = processing.reduce((sum, document) => sum + (document.chunks_done ?? 0), 0);
  const sectionsTotal = processing.reduce((sum, document) => sum + (document.chunks_total ?? 0), 0);

  return <section
    onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={drop}
    className={`mx-auto w-full max-w-xl px-1 py-12 text-center transition-opacity ${dragging ? "opacity-70" : ""}`}
    aria-label="Upload documents to start chatting"
  >
    {state === "empty" && <>
      <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl">↑</div>
      <h1 className="mt-5 text-2xl font-semibold">Please upload your documents to get started</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-300">PDF, Word, text or Markdown files, or photos of your notes. Then ask anything about them.</p>
      {uploader.limitReached ? <div role="alert" className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-amber-300/40 bg-amber-950/85 p-4 text-sm text-white"><span>You’ve reached your document allowance.</span><Link href="/upgrade" className="rounded-full bg-white px-4 py-2 font-semibold text-slate-950">Upgrade</Link></div>
        : <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button type="button" onClick={uploader.openPicker} aria-label="Upload documents" className="rounded-full bg-white px-5 py-2.5 font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">Upload documents</button>
          <Link href="/documents" className="text-sm font-medium text-slate-200 underline underline-offset-4">Go to Documents</Link>
        </div>}
    </>}

    {(state === "processing" || processing.length > 0) && <div role="status" className="mt-2">
      <h1 className="text-xl font-semibold">Reading your files{sectionsTotal ? `, ${sectionsDone} of ${sectionsTotal} sections` : ""}</h1>
      <p className="mt-2 text-sm text-slate-300">You can ask questions as soon as the first file is ready.</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-sky-300 transition-[width]" style={{ width: `${sectionsTotal ? Math.min(100, Math.round(sectionsDone / sectionsTotal * 100)) : 15}%` }} /></div>
      {(done.length > 0 || processing.length > 0) && <button type="button" onClick={uploader.openPicker} className="mt-5 rounded-full border border-white/20 px-4 py-2 text-sm">Upload another</button>}
    </div>}

    {state === "all-failed" && <div>
      <h1 className="text-xl font-semibold">We could not read these files</h1>
      <div className="mt-5 space-y-3 text-left">{failed.map(document => <div key={document.id} role="alert" className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-3"><p className="min-w-0 flex-1 text-sm">{document.filename}: {document.error_message || "Processing failed."}</p><button type="button" onClick={() => void uploader.retryDocument(document.id)} className="shrink-0 font-semibold underline">Retry</button></div>)}</div>
      <button type="button" onClick={uploader.openPicker} className="mt-5 rounded-full bg-white px-5 py-2.5 font-semibold text-slate-950">Upload another</button>
    </div>}

    <input ref={uploader.input} type="file" multiple accept="image/*,.pdf,.docx,.txt,.md" capture="environment" className="hidden" onChange={event => void uploader.upload(Array.from(event.target.files ?? []))} />
  </section>;
}
