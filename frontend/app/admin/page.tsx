"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminRequest, api, UsageSummary } from "../../lib/api";

type Tab = "pending" | "approved" | "rejected";

export default function AdminPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<Record<Tab, AdminRequest[]>>({ pending: [], approved: [], rejected: [] });
  const [summary, setSummary] = useState<{ last_7_days: UsageSummary; last_30_days: UsageSummary } | null>(null);
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [tokens, setTokens] = useState("");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [notifierConfigured, setNotifierConfigured] = useState(true);
  const [mailerConfigured, setMailerConfigured] = useState(true);
  const [mailProvider, setMailProvider] = useState<"smtp" | "apps_script" | "none">("smtp");
  const [notifyUser, setNotifyUser] = useState(true);
  const [emailTest, setEmailTest] = useState<{ provider: string; ok: boolean; error: string; remaining?: number } | null>(null);

  async function refresh() {
    const statuses: Tab[] = ["pending", "approved", "rejected"];
    const values = await Promise.all(statuses.map(status => api.adminRequests(status)));
    setRequests({ pending: values[0], approved: values[1], rejected: values[2] });
  }
  useEffect(() => {
    void api.adminMe().then(async status => { setNotifierConfigured(status.notifier_configured); setMailerConfigured(status.mailer_configured !== false); setMailProvider(status.mail_provider ?? "smtp"); setAllowed(true); await refresh(); void api.adminUsageSummary().then(setSummary).catch(() => undefined); }).catch(() => router.replace("/"));
  }, [router]);
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(timer);
  }, [allowed]);

  async function approve(request: AdminRequest) {
    if (!window.confirm(`Approve ${request.email}'s request for ${request.package}?`)) return;
    setBusy(request.id);
    try { await api.approvePayment(request.id); await refresh(); } finally { setBusy(""); }
  }
  async function reject(request: AdminRequest) {
    const reason = window.prompt("Reason for rejection (required)")?.trim();
    if (!reason) return;
    setBusy(request.id);
    try { await api.rejectPayment(request.id, reason); await refresh(); } finally { setBusy(""); }
  }
  async function grant() {
    setBusy("grant");
    try { await api.adminGrant(email.trim(), Number(tokens || 0), Number(days || 0), note.trim(), notifyUser); setMessage("Grant sent."); setEmail(""); setTokens(""); setDays(""); setNote(""); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Grant failed."); }
    finally { setBusy(""); }
  }
  async function sendEmailTest() {
    setBusy("email-test");
    try { setEmailTest(await api.adminEmailTest()); }
    catch (caught) { setEmailTest({ provider: mailProvider, ok: false, error: caught instanceof Error ? caught.message : "Test email failed." }); }
    finally { setBusy(""); }
  }

  if (!allowed) return <div className="flex h-full items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" /></div>;
  return <div className="app-page h-full overflow-y-auto text-white">
    <div className="app-page-inner mx-auto max-w-6xl">
      <h1 className="text-3xl font-semibold">Admin dashboard</h1>
      {!notifierConfigured && <p role="status" className="mt-4 text-sm text-amber-200">Email alerts are off; check Pending regularly</p>}
      {!mailerConfigured && <p role="status" className="mt-2 rounded border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-200">User email is disabled; configure Gmail SMTP to send user notifications.</p>}
      {mailProvider === "none" && <p role="status" className="mt-2 rounded border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-200">User email is off because MAIL_PROVIDER=none.</p>}
      <section className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={Boolean(busy)} onClick={() => void sendEmailTest()} className="rounded border border-sky-300 px-3 py-2 text-sm">Send test email</button>
        {emailTest && <p role="status" className={`text-sm ${emailTest.ok ? "text-emerald-200" : "text-red-200"}`}>
          {emailTest.ok ? `Sent via ${emailTest.provider}${typeof emailTest.remaining === "number" ? ` · ${emailTest.remaining} quota remaining` : ""}` : `${emailTest.error || "Test email failed"}${emailTest.provider ? ` · ${emailTest.provider}` : ""}`}
        </p>}
      </section>
      <div className="app-tabs mt-6 flex gap-6">
        {(["pending", "approved", "rejected"] as Tab[]).map(item => <button key={item} onClick={() => setTab(item)} className={`px-4 py-2 capitalize ${tab === item ? "border-b-2 border-sky-300 font-semibold" : "text-slate-300"}`}>
          {item}{item === "pending" && requests.pending.length > 0 && <span className="ml-2 rounded-full bg-amber-300 px-2 text-xs text-slate-950">{requests.pending.length}</span>}
        </button>)}
      </div>
      <div className="mt-4 space-y-3">
        {requests[tab].map(request => <div key={request.id} className="app-row p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="font-semibold">{request.full_name || request.email}</p><p className="text-sm text-slate-300">{request.email}</p><p className="mt-2">{request.package} · KSh {request.amount_ksh}</p>
              <p className="mt-1 text-sm text-slate-300">{new Date(request.created_at).toLocaleString()}</p>
              {tab !== "pending" && <p className="mt-1 text-sm text-slate-300">Email: {request.notify_status || "not sent"}</p>}</div>
            <div className="flex items-center gap-2"><code className="rounded bg-white/10 px-3 py-2">{request.mpesa_code}</code><button onClick={() => void navigator.clipboard.writeText(request.mpesa_code)} className="rounded border border-white/20 px-2 py-2 text-sm">Copy</button></div>
          </div>
          {tab === "pending" && <div className="mt-4 flex gap-2"><button disabled={Boolean(busy)} onClick={() => void approve(request)} className="rounded bg-emerald-300 px-3 py-2 font-semibold text-slate-950 disabled:opacity-50">Approve</button><button disabled={Boolean(busy)} onClick={() => void reject(request)} className="rounded bg-red-300 px-3 py-2 font-semibold text-slate-950 disabled:opacity-50">Reject</button></div>}
          {tab !== "pending" && request.notify_status === "failed" && <button disabled={Boolean(busy)} onClick={async () => { setBusy(request.id); try { await api.resendPaymentEmail(request.id); await refresh(); } finally { setBusy(""); } }} className="mt-3 rounded border border-sky-300 px-3 py-2 text-sm">Resend email</button>}
        </div>)}
        {requests[tab].length === 0 && <p className="text-slate-300">No {tab} requests.</p>}
      </div>
      <section className="app-admin-section mt-10">
        <h2 className="text-xl font-semibold">Manual grant</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4"><input value={email} onChange={event => setEmail(event.target.value)} placeholder="User email" className="rounded bg-slate-950 px-3 py-2" /><input value={tokens} onChange={event => setTokens(event.target.value)} type="number" min="0" placeholder="Tokens" className="rounded bg-slate-950 px-3 py-2" /><input value={days} onChange={event => setDays(event.target.value)} type="number" min="0" placeholder="Premium days" className="rounded bg-slate-950 px-3 py-2" /><input value={note} onChange={event => setNote(event.target.value)} placeholder="Note" className="rounded bg-slate-950 px-3 py-2 md:col-span-1" /></div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={notifyUser} onChange={event => setNotifyUser(event.target.checked)} /> Notify user by email</label>
        <button disabled={busy === "grant"} onClick={() => void grant()} className="mt-3 rounded bg-white px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Grant</button>
        {message && <p className="mt-3 text-sm text-slate-200">{message}</p>}
      </section>
      {summary && <section className="mt-6 grid gap-12 md:grid-cols-2"><div><h2 className="font-semibold">Last 7 days</h2><p className="mt-2">Answers: {summary.last_7_days.answers}</p><p>Average input: {summary.last_7_days.average_input_tokens}</p><p>Average output: {summary.last_7_days.average_output_tokens}</p></div><div><h2 className="font-semibold">Last 30 days</h2><p className="mt-2">Answers: {summary.last_30_days.answers}</p><p>Average input: {summary.last_30_days.average_input_tokens}</p><p>Average output: {summary.last_30_days.average_output_tokens}</p></div></section>}
    </div>
  </div>;
}
