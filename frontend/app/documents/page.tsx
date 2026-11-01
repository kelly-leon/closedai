"use client";

import Link from "next/link";
import { DragEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, DocumentItem } from "../../lib/api";
import { supabaseAuthEnabled } from "../../lib/supabase";
import { sharedGet, invalidateShared } from "../../lib/sharedData";

interface UploadState { name: string; progress: number; file?: File; error?: string; retryable?: boolean }
const allowed = new Set(["pdf", "docx", "txt", "md"]);
const maxBytes = 50 * 1024 * 1024;

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [loading, setLoading] = useState(true);
  const [slowLoading, setSlowLoading] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [unitId, setUnitId] = useState("");
  const [limitReached, setLimitReached] = useState(false);

  async function load() {
    const selected = window.localStorage.getItem("closedai-unit-id");
    if (!selected) return;
    setLoading(true);
    try {
      setDocuments(await sharedGet(`documents:${selected}`, () => api.documents(selected)));
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught : new ApiError("We couldn't load this. Try again."));
    } finally { setLoading(false); }
  }
  useEffect(() => {
    const selected = window.localStorage.getItem("closedai-unit-id") ?? "";
    setUnitId(selected);
    void load();
    const refresh = (event: Event) => { setUnitId((event as CustomEvent<string>).detail); };
    window.addEventListener("closedai:unit-changed", refresh);
    return () => window.removeEventListener("closedai:unit-changed", refresh);
  }, []);
  useEffect(() => { if (unitId) void load(); }, [unitId]);
  useEffect(() => {
    if (!loading) { setSlowLoading(false); return; }
    const timer = window.setTimeout(() => setSlowLoading(true), 8000);
    return () => window.clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    if (!documents.some(document => document.status === "pending" || document.status === "processing")) return;
    const timer = window.setInterval(() => {
      invalidateShared(`documents:${unitId}`);
      void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [documents]);

  async function upload(files: File[]) {
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const validation = !allowed.has(extension) ? "Unsupported file type." : file.size > maxBytes ? "File is larger than 50 MB." : null;
      if (validation) { setUploads(current => [...current, { name: file.name, progress: 0, error: validation }]); continue; }
      setUploads(current => [...current, { name: file.name, progress: 0, file }]);
      try {
        if (supabaseAuthEnabled) {
          const signed = await api.uploadDocumentUrl(file, unitId);
          await api.uploadSignedDocument(signed.upload_url, file, progress => setUploads(current => current.map(item => item.name === file.name ? { ...item, progress } : item)));
          await api.registerHostedDocument(signed.storage_path, file, unitId);
        } else {
          await api.uploadDocument(file, unitId, progress => setUploads(current => current.map(item => item.name === file.name ? { ...item, progress } : item)));
        }
        invalidateShared(`documents:${unitId}`);
        await load();
      }
      catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed.";
        if (error instanceof ApiError && error.code === "limit_reached") setLimitReached(true);
        else if (/limit|quota|upgrade/i.test(message)) setLimitReached(true);
        const retryable = supabaseAuthEnabled && /uploaded to storage/i.test(message);
        setUploads(current => current.map(item => item.name === file.name ? { ...item, error: message, retryable } : item));
      }
    }
  }
  async function retryUpload(item: UploadState) {
    if (!item.file) return;
    setUploads(current => current.filter(upload => upload !== item));
    await upload([item.file]);
  }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }
  async function remove(id: string, filename: string) { if (!window.confirm(`Delete ${filename}?`)) return; await api.deleteDocument(id); await load(); }
  async function retry(id: string) { try { await api.retryDocument(id); await load(); } catch (error) { window.alert(error instanceof Error ? error.message : "Retry failed."); } }

  return <div className="app-page h-full overflow-y-auto">
    <div className="app-page-inner mx-auto max-w-4xl">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">Documents</h1><p className="rounded bg-slate-950/70 px-2 py-1 text-sm text-slate-200 [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">Upload files for grounded answers.</p></div><Link href="/" className="rounded-lg border px-3 py-2 text-sm backdrop-blur">Back to chat</Link></div>
      <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} onClick={() => input.current?.click()} className={`app-drop mt-6 cursor-pointer transition ${dragging ? "app-drop-active" : ""}`} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter") input.current?.click(); }}>
        <input ref={input} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden" onChange={event => void upload(Array.from(event.target.files ?? []))} />
        <p className="font-medium">Drop files here or click to upload</p><p className="mt-1 text-xs text-slate-200 [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">PDF, DOCX, TXT, or MD · up to 50 MB each</p>
      </div>
      {limitReached && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300/40 bg-amber-950/85 p-4 text-white"><span>You’ve reached your document allowance. Upgrade to keep adding files.</span><Link href="/upgrade" className="rounded-full bg-white px-3 py-1 font-semibold text-slate-950">Upgrade</Link></div>}
      {uploads.length > 0 && <div className="mt-4 space-y-2">{uploads.map((item, index) => <div key={`${item.name}-${index}`} className="rounded-lg border p-3 dark:border-slate-800"><div className="flex justify-between text-sm"><span className="truncate">{item.name}</span><span>{item.error ?? `${item.progress}%`}</span></div>{item.error && item.retryable && <button type="button" onClick={() => void retryUpload(item)} className="mt-2 text-sm font-medium text-blue-600">Retry</button>}{!item.error && <div className="mt-2 h-1 overflow-hidden rounded bg-slate-200"><div className="h-full bg-slate-900" style={{ width: `${item.progress}%` }} /></div>}</div>)}</div>}
      {loading ? <div className="mt-8"><div className="h-24 animate-pulse bg-white/5" />{slowLoading && <div role="status" className="mt-3 text-sm text-slate-300"><p>Still loading...</p><button type="button" onClick={() => void load()} className="mt-2 rounded bg-white px-3 py-1.5 font-semibold text-slate-950">Retry</button></div>}</div> : loadError ? <div role="alert" className="mt-8 rounded-lg border border-red-300/30 bg-red-950/70 p-4 text-red-100"><p>We couldn't load this. Try again.{loadError.requestId ? ` Request ID: ${loadError.requestId}` : ""}</p><button type="button" onClick={() => void load()} className="mt-3 rounded bg-white px-3 py-1.5 text-sm font-semibold text-slate-950">Retry</button></div> : documents.length === 0 ? <div className="py-16 text-center text-slate-100"><p>No documents yet.</p><p className="mt-1 text-sm text-slate-300">Upload one above to start asking grounded questions.</p></div> : <div className="mt-8">{documents.map(document => <div key={document.id} className="app-row flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{document.filename}</p>{document.status === "failed" && <p className="mt-1 text-xs text-red-300">{document.error_message || "Processing failed."}</p>}</div><span className="text-xs font-medium capitalize" data-status={document.status}><i className={`status-dot ${document.status}`} />{document.status}</span>{document.status === "failed" && <button onClick={() => void retry(document.id)} className="app-text-button text-sm">Retry</button>}<button onClick={() => void remove(document.id, document.filename)} className="app-text-button text-sm text-red-300" aria-label={`Delete ${document.filename}`}>Delete</button></div>)}</div>}
    </div>
  </div>;
}
