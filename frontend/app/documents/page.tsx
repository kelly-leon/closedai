"use client";

import Link from "next/link";
import { DragEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { invalidateShared } from "../../lib/sharedData";
import { invalidateQuery } from "../../lib/query";
import { BackToChat } from "../../components/BackToChat";
import { useDocumentUploader } from "../../hooks/useDocumentUploader";

export default function DocumentsPage() {
  const [unitId, setUnitId] = useState("");
  const [slowLoading, setSlowLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const uploader = useDocumentUploader(unitId);
  const { documents, uploads, loading, loadError, limitReached, input, upload, retryUpload, retryDocument, refreshAfterChange } = uploader;

  useEffect(() => {
    setUnitId(window.localStorage.getItem("closedai-unit-id") ?? "");
    const refresh = (event: Event) => setUnitId((event as CustomEvent<string>).detail);
    window.addEventListener("closedai:unit-changed", refresh);
    return () => window.removeEventListener("closedai:unit-changed", refresh);
  }, []);
  useEffect(() => {
    if (!loading) { setSlowLoading(false); return; }
    const timer = window.setTimeout(() => setSlowLoading(true), 8000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(Array.from(event.dataTransfer.files));
  }
  async function remove(id: string, filename: string) {
    if (!window.confirm(`Delete ${filename}?`)) return;
    const previous = documents;
    setDeleteError("");
    refreshAfterChange();
    try {
      await api.deleteDocument(id);
      invalidateShared(`documents:${unitId}`);
      invalidateQuery(`documents:${unitId}`);
      invalidateQuery("usage");
      void uploader.load(true);
      void api.usage();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Document deletion failed.");
      void uploader.load(true);
      void previous;
    }
  }

  return <div className="app-page h-full overflow-y-auto">
    <div className="app-page-inner mx-auto max-w-4xl">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">Documents</h1><p className="rounded bg-slate-950/70 px-2 py-1 text-sm text-slate-200 [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">Upload files for grounded answers.</p></div><BackToChat className="rounded-lg border px-3 py-2 text-sm backdrop-blur" /></div>
      {deleteError && <div role="alert" className="mt-4 rounded-lg border border-red-300/30 bg-red-950/70 p-3 text-red-100">Document deletion failed: {deleteError}</div>}
      <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} onClick={() => input.current?.click()} className={`app-drop mt-6 cursor-pointer transition ${dragging ? "app-drop-active" : ""}`} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter") input.current?.click(); }}>
        <input ref={input} type="file" multiple accept="image/*,.pdf,.docx,.txt,.md" capture="environment" className="hidden" onChange={event => void upload(Array.from(event.target.files ?? []))} />
        <p className="font-medium">Drop files here or click to upload</p><p className="mt-1 text-xs text-slate-200 [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">PDF, DOCX, TXT, MD, JPG, JPEG, PNG, or WebP · images up to 5 MB</p>
      </div>
      {limitReached && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300/40 bg-amber-950/85 p-4 text-white"><span>You’ve reached your document allowance. Upgrade to keep adding files.</span><Link href="/upgrade" className="rounded-full bg-white px-3 py-1 font-semibold text-slate-950">Upgrade</Link></div>}
      {uploads.length > 0 && <div className="mt-4 space-y-2">{uploads.map((item, index) => <div key={`${item.name}-${index}`} className="rounded-lg border p-3 dark:border-slate-800"><div className="flex items-center gap-3 text-sm">{item.preview ? <img src={item.preview} alt="" className="h-12 w-12 rounded object-cover" /> : <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded bg-white/10">▣</span>}<span className="min-w-0 flex-1 truncate">{item.name}</span><span>{item.error ?? `${item.progress}%`}</span></div>{item.error && item.retryable && <button type="button" onClick={() => void retryUpload(item)} className="mt-2 text-sm font-medium text-blue-600">Retry</button>}{!item.error && <div className="mt-2 h-1 overflow-hidden rounded bg-slate-200"><div className="h-full bg-slate-900" style={{ width: `${item.progress}%` }} /></div>}</div>)}</div>}
      {loading ? <div className="mt-8"><div className="h-24 animate-pulse bg-white/5" />{slowLoading && <div role="status" className="mt-3 text-sm text-slate-300"><p>Still loading...</p><button type="button" onClick={() => void uploader.load(true)} className="mt-2 rounded bg-white px-3 py-1.5 font-semibold text-slate-950">Retry</button></div>}</div>
        : loadError ? <div role="alert" className="mt-8 rounded-lg border border-red-300/30 bg-red-950/70 p-4 text-red-100"><p>{loadError.message || "We couldn't load this."}</p><button type="button" onClick={() => void uploader.load(true)} className="mt-3 rounded bg-white px-3 py-1.5 text-sm font-semibold text-slate-950">Retry</button></div>
        : documents.length === 0 ? <div className="py-16 text-center text-slate-100"><p>No documents yet.</p><p className="mt-1 text-sm text-slate-300">Upload one above to start asking grounded questions.</p></div>
        : <div className="mt-8">{documents.map(document => {
          const percent = document.status === "processing" && document.chunks_total ? Math.min(100, Math.round((document.chunks_done ?? 0) / document.chunks_total * 100)) : 0;
          const image = ["jpg", "jpeg", "png", "webp"].includes(document.filename.split(".").pop()?.toLowerCase() ?? "");
          return <div key={document.id} className="app-row flex items-center gap-3">{image && <span aria-label="Image" className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/10">▣</span>}<div className="min-w-0 flex-1"><p className="truncate font-medium">{document.filename}</p>{document.status === "processing" && <div className="mt-2"><p className="text-xs text-slate-300">{document.error_message || `Embedding ${document.chunks_done ?? 0} of ${document.chunks_total ?? 0} sections`}</p><div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10">          <div className="h-full bg-sky-300" style={{ width: `${percent}%` }} /></div></div>}{document.status === "failed" && <p className="mt-1 text-xs text-red-300">{document.error_message || "Processing failed."}</p>}</div><span className="text-xs font-medium capitalize" data-status={document.status}><i className={`status-dot ${document.status}`} />{document.status}</span>{document.status === "failed" && <button onClick={() => void retryDocument(document.id).catch((error: unknown) => window.alert(error instanceof Error ? error.message : "Retry failed."))} className="app-text-button text-sm">Retry</button>}<button onClick={() => void remove(document.id, document.filename)} className="app-text-button text-sm text-red-300" aria-label={`Delete ${document.filename}`}>Delete</button></div>;
        })}</div>}
    </div>
  </div>;
}
