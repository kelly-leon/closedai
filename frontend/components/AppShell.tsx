"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api, ConversationSummary, SERVER_WAKE_MESSAGE, Unit, Usage } from "../lib/api";
import { supabase, supabaseAuthEnabled } from "../lib/supabase";
import { invalidateShared } from "../lib/sharedData";
import { installQueryLifecycleListeners } from "../lib/query";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [initialError, setInitialError] = useState("");
  const [unitsError, setUnitsError] = useState<ApiError | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [wakingServer, setWakingServer] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const authPage = ["/login", "/signup", "/forgot-password", "/auth/reset"].includes(pathname);
  const publicPage = pathname === "/" || pathname === "/privacy" || pathname === "/terms";

  async function load() {
    if (!unitId) return;
    setLoading(true);
    try {
      setConversations(await api.conversations(unitId));
      setConversationsError(null);
    } catch (caught) {
      setConversationsError(caught instanceof ApiError ? caught : new ApiError("We couldn't load this. Try again."));
    } finally { setLoading(false); }
  }
  async function loadWorkspace() {
    const startedAt = Date.now();
    setSlowLoading(false);
    const slowTimer = window.setTimeout(() => setSlowLoading(true), 8000);
    setInitialError("");
    if (supabaseAuthEnabled && supabase) {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
    }
    const saved = window.localStorage.getItem("closedai-unit-id") ?? undefined;
    try {
      const bootstrap = await api.bootstrap(saved);
      setUnits(bootstrap.units);
      setUsage(bootstrap.usage);
      setConversations(bootstrap.conversations);
      setUnitsError(null);
      const selected = bootstrap.units.find(item => item.id === saved) ?? bootstrap.units[0];
      if (selected) {
        setUnitId(selected.id);
        window.localStorage.setItem("closedai-unit-id", selected.id);
      } else {
        setUnitId("");
        window.localStorage.removeItem("closedai-unit-id");
      }
      setLoading(false);
      window.clearTimeout(slowTimer);
      if (process.env.NODE_ENV === "development") console.info(`[ClosedAI] initial shell request: ${Date.now() - startedAt}ms`);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError("We couldn't load this. Try again.");
      setUnitsError(error);
      setInitialError("");
      window.clearTimeout(slowTimer);
      window.setTimeout(() => void loadWorkspace(), 15_000);
    }
  }

  useEffect(() => {
    if (authPage || (supabaseAuthEnabled && publicPage)) return;
    if (supabase) void supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? "");
      const metadata = data.user?.user_metadata as { full_name?: string } | undefined;
      setUserName(metadata?.full_name?.trim() ?? "");
    });
    installQueryLifecycleListeners();
    setCollapsed(window.localStorage.getItem("closedai-sidebar-collapsed") === "true");
    void loadWorkspace();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<ConversationSummary>).detail;
      if (detail) setConversations(current => current.some(item => item.id === detail.id) ? current : [detail, ...current]);
    };
    window.addEventListener("closedai:conversation-created", refresh);
    const wake = (event: Event) => setWakingServer((event as CustomEvent<boolean>).detail);
    window.addEventListener("closedai:server-waking", wake);
    return () => {
      window.removeEventListener("closedai:conversation-created", refresh);
      window.removeEventListener("closedai:server-waking", wake);
    };
  }, []);

  useEffect(() => {
    if (!unitId) return;
    window.localStorage.setItem("closedai-unit-id", unitId);
    void load();
    window.dispatchEvent(new CustomEvent("closedai:unit-changed", { detail: unitId }));
  }, [unitId]);

  if (authPage || (supabaseAuthEnabled && publicPage)) return <>{children}</>;

  async function refreshUnits() {
    const items = await api.units();
    setUnits(items);
    if (!items.some(item => item.id === unitId) && items[0]) setUnitId(items[0].id);
  }
  async function createUnit() {
    const name = window.prompt("Unit name"); if (!name?.trim()) return;
    const unit = await api.createUnit(name.trim()); await refreshUnits(); setUnitId(unit.id);
  }
  async function renameUnit() {
    const unit = units.find(item => item.id === unitId); if (!unit) return;
    const name = window.prompt("Rename unit", unit.name); if (!name?.trim()) return;
    await api.renameUnit(unit.id, name.trim()); await refreshUnits();
  }
  async function deleteUnit() {
    const unit = units.find(item => item.id === unitId); if (!unit || !window.confirm(`Delete ${unit.name} and all of its content?`)) return;
    await api.deleteUnit(unit.id); setUnitId(""); await refreshUnits();
  }
  async function redeem() {
    if (!redeemCode.trim()) return;
    try { await api.redeem(redeemCode.trim()); setRedeemCode(""); setUsage(await api.usage()); } catch (error) { window.alert(error instanceof Error ? error.message : "Invalid code."); }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "DELETE") return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteAccount();
      try { await supabase?.auth.signOut(); } catch { /* local cleanup still completes after deletion. */ }
      window.localStorage.clear();
      router.replace("/?deleted=success");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Your account could not be deleted. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  function toggleCollapsed() {
    setCollapsed(current => {
      const next = !current;
      window.localStorage.setItem("closedai-sidebar-collapsed", String(next));
      return next;
    });
  }

  function newChat() {
    window.dispatchEvent(new CustomEvent("closedai:new-chat"));
    setOpen(false);
    router.push(supabaseAuthEnabled ? "/app" : "/");
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this conversation?")) return;
    await api.deleteConversation(id);
    await load();
    if (pathname.includes(id)) router.push(supabaseAuthEnabled ? "/app" : "/");
  }

  const rail = collapsed;
  if (initialError) return <main className="relative z-10 flex h-screen items-center justify-center bg-slate-950 px-5 text-center text-white"><div><p role="alert" className="max-w-md text-slate-200">{initialError}</p><button type="button" onClick={() => void loadWorkspace()} className="mt-4 rounded-lg bg-sky-300 px-4 py-2 font-semibold text-slate-950">Retry</button></div></main>;
  return <div className="app-shell relative z-10 flex h-screen overflow-hidden text-slate-100 supports-[height:100dvh]:h-dvh">
    {wakingServer && <div role="status" className="fixed inset-x-0 top-3 z-[100] mx-auto flex w-fit items-center gap-3 rounded-xl border border-sky-300/20 bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-xl">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-transparent" />
      <span>{SERVER_WAKE_MESSAGE}</span>
    </div>}
    <header className="app-mobile-bar md:hidden">
      <button onClick={() => setOpen(!open)} aria-label="Toggle navigation">☰</button>
      <Link href="/" className="app-mobile-home" onClick={() => setOpen(false)}><span aria-hidden="true">⌂</span> Home</Link>
    </header>
    <aside className={`app-sidebar ${open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex h-full w-72 shrink-0 flex-col overflow-hidden text-slate-100 transition-[transform,width] duration-300 md:static md:translate-x-0 ${rail ? "md:w-16" : "md:w-72"}`}>
      <div className={`shrink-0 p-3 ${rail ? "md:px-2" : ""}`}>
        {!rail && <div className="mb-3 flex gap-1">
          <select value={unitId} onChange={event => setUnitId(event.target.value)} aria-label="Unit" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm">
            {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
          <button onClick={() => void createUnit()} title="Create unit" className="rounded-lg bg-white/10 px-2">+</button>
          <button onClick={() => void renameUnit()} title="Rename unit" className="rounded-lg bg-white/10 px-2">✎</button>
          <button onClick={() => void deleteUnit()} title="Delete unit" className="rounded-lg bg-white/10 px-2">×</button>
        </div>}
        <div className={`app-brand-row flex items-center ${rail ? "justify-center" : "justify-between"}`}>
          {!rail && <Link href={supabaseAuthEnabled ? "/app" : "/"} className="app-wordmark" onClick={() => setOpen(false)}>ClosedAI</Link>}
          {rail && <button onClick={toggleCollapsed} className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 md:flex" aria-label="Expand sidebar" title="Expand sidebar">›</button>}
          {!rail && <button onClick={toggleCollapsed} className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 md:flex" aria-label="Collapse sidebar" title="Collapse sidebar">‹</button>}
          <button onClick={() => setOpen(false)} className="h-9 w-9 rounded-lg text-slate-200 hover:bg-white/10 md:hidden" aria-label="Close navigation">×</button>
        </div>
        {!rail && <Link href="/" className="app-home-link" onClick={() => setOpen(false)}><span aria-hidden="true">⌂</span> Home</Link>}
        {rail && <Link href="/" className="app-home-link icon-only" aria-label="Home" title="Home"><span aria-hidden="true">⌂</span></Link>}
        <button onClick={newChat} className={`app-new-chat mt-2 flex h-10 items-center justify-center font-semibold text-white ${rail ? "w-12" : "w-full px-3 text-sm"}`} aria-label="New chat" title="New chat"><span aria-hidden="true">＋</span>{!rail && <span className="ml-2">New chat</span>}</button>
        <Link href="/documents" onClick={() => setOpen(false)} className={`mt-1 flex h-10 items-center rounded-lg text-slate-100 hover:bg-white/10 ${rail ? "w-12 justify-center" : "px-3 text-sm"}`} aria-label="Documents" title="Documents"><span aria-hidden="true">▣</span>{!rail && <span className="ml-2">Documents</span>}</Link>
      </div>
      {!rail && <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="Conversations">
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-300 [text-shadow:_0_1px_3px_rgba(0,0,0,0.9)]">Chats</p>
        {loading && <div className="mt-2 h-10 animate-pulse rounded-lg bg-slate-600/30" />}
        {loading && slowLoading && <div className="px-2 py-3 text-sm text-slate-300"><p>Still loading...</p><button type="button" onClick={() => void loadWorkspace()} className="mt-2 rounded bg-white px-3 py-1.5 font-semibold text-slate-950">Retry</button></div>}
        {!loading && conversationsError && <div role="alert" className="px-2 py-4 text-sm text-red-200"><p>We couldn't load this. Try again.{conversationsError.requestId ? ` Request ID: ${conversationsError.requestId}` : ""}</p><button type="button" onClick={() => void load()} className="mt-2 rounded bg-white px-3 py-1.5 font-semibold text-slate-950">Retry</button></div>}
        {unitsError && !loading && <div role="alert" className="px-2 py-4 text-sm text-red-200"><p>Couldn't load your units. Retry</p>{unitsError.requestId && <p className="mt-1">Request ID: {unitsError.requestId}</p>}<button type="button" onClick={() => void loadWorkspace()} className="mt-2 rounded bg-white px-3 py-1.5 font-semibold text-slate-950">Retry</button></div>}
        {!loading && !conversationsError && !unitsError && conversations.length === 0 && <p className="px-2 py-4 text-sm text-slate-300">No conversations yet.</p>}
        {conversations.map(item => <div key={item.id} className={`app-conversation group mt-1 flex items-center ${pathname === `/chat/${item.id}` ? "active text-white" : "text-slate-200"}`}>
          <Link href={`/chat/${item.id}`} onClick={() => setOpen(false)} className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-slate-100">{item.title}</Link>
          <button onClick={() => void remove(item.id)} className="invisible px-2 text-slate-300 group-hover:visible" aria-label={`Delete ${item.title}`}>×</button>
        </div>)}
      </nav>}
      {!rail && usage && usage.plan !== "unlimited" && <div className="shrink-0 border-t border-white/10 p-3 text-xs text-white">
        {usage.plan === "trial" && <>
          <div className="flex justify-between gap-2"><span>Trial</span><span>{usage.trial_tokens_remaining ?? usage.tokens_available ?? 0} of 100 tokens left</span></div>
          {usage.trial_resets_at && <p className="mt-1 text-slate-300">Resets in {Math.max(0, Math.ceil((new Date(usage.trial_resets_at).getTime() - Date.now()) / 86400000))} days</p>}
          <div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-full rounded bg-sky-400" style={{ width: `${Math.min(100, Number(usage.trial_tokens_remaining ?? 0))}%` }} /></div>
        </>}
        {usage.plan === "paid" && <div className="flex justify-between"><span>Token balance</span><span>{usage.token_balance ?? 0}</span></div>}
        {usage.plan === "premium" && <>
          <div>Premium until {usage.premium_until ? new Date(usage.premium_until).toLocaleDateString() : ""}</div>
          <div className="mt-1 flex justify-between"><span>Answers today</span><span>{usage.daily_used ?? 0} of 100</span></div>
        </>}
        <div className="mt-2 flex justify-between"><span>Documents</span><span>{usage.documents_used}/{usage.document_quota}</span></div>
        <div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-full rounded bg-emerald-400" style={{ width: `${Math.min(100, 100 * Number(usage.documents_used ?? 0) / Math.max(1, Number(usage.document_quota ?? 1)))}%` }} /></div>
      </div>}
      {!rail && supabaseAuthEnabled && <div className="app-account shrink-0 p-3 text-xs text-white">
          <Link href="/upgrade" className="mb-3 block w-full rounded-lg bg-amber-300 py-2 text-center font-semibold text-slate-950">Upgrade</Link>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-white">{userName || userEmail}</span>
            <div className="flex gap-2">
              <button onClick={() => { setDeleteDialog(true); setDeleteConfirmation(""); setDeleteError(""); }} className="rounded px-2 py-1 text-red-300 hover:bg-red-950/40">Delete my account</button>
              <button onClick={async () => { await supabase?.auth.signOut(); window.localStorage.removeItem("closedai-unit-id"); router.replace("/login"); }} className="rounded bg-white/10 px-2 py-1 hover:bg-white/15">Sign out</button>
            </div>
          </div>
      </div>}
    </aside>
    {deleteDialog && <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-slate-950 p-6 text-white">
        <h2 id="delete-account-title" className="text-xl font-semibold">Delete my account</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">This permanently deletes your documents, extracted text, conversations, units, usage data, payment requests, account plan, and profile. Type DELETE to continue.</p>
        <label htmlFor="delete-confirmation" className="mt-5 block text-sm">Confirmation</label>
        <input id="delete-confirmation" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} className="mt-2 w-full border-b border-white/40 bg-transparent px-0 py-2 focus:border-red-300 focus:outline-none" autoComplete="off" />
        {deleteError && <p role="alert" className="mt-3 text-sm text-red-200">Error: {deleteError}</p>}
        <div className="mt-6 flex justify-end gap-4 text-sm">
          <button disabled={deleting} onClick={() => setDeleteDialog(false)} className="text-slate-300">Cancel</button>
          <button disabled={deleting || deleteConfirmation !== "DELETE"} onClick={() => void deleteAccount()} className="font-semibold text-red-300 disabled:opacity-40">{deleting ? "Deleting..." : "Delete permanently"}</button>
        </div>
      </div>
    </div>}
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
  </div>;
}
