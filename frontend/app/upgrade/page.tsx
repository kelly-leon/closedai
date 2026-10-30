"use client";

import { useEffect, useState } from "react";
import { api, BillingPackage, BillingRequest } from "../../lib/api";

export default function UpgradePage() {
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [till, setTill] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [requests, setRequests] = useState<BillingRequest[]>([]);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    try {
      const data = await api.paymentRequests();
      setRequests(data);
    } catch { /* Keep the existing request list visible. */ }
  }

  useEffect(() => {
    void api.billingPackages().then(data => { setPackages(data.packages); setTill(data.till_number); }).catch(() => setError("We couldn't load packages. Please try again."));
    void refresh();
  }, []);
  useEffect(() => {
    if (!requests.some(request => request.status === "pending")) return;
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(timer);
  }, [requests]);

  async function submit() {
    if (selected === null) return setError("Choose a package first.");
    if (!/^[A-Z0-9]{10}$/.test(code)) return setError("Enter exactly 10 letters or numbers from your M-Pesa message.");
    setSubmitting(true); setError("");
    try {
      await api.submitPayment(selected, code);
      setConfirmation("Request received. Token award takes 30 to 60 minutes after verification. You will see the status below.");
      setCode("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't submit that request.");
    } finally { setSubmitting(false); }
  }

  const bestValue = packages.filter(item => item.tokens).sort((a, b) => ((b.tokens ?? 0) / b.price_ksh) - ((a.tokens ?? 0) / a.price_ksh))[0]?.id;

  return <div className="h-full overflow-y-auto p-4 text-white md:p-8">
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold">Upgrade ClosedAI</h1>
      <p className="mt-2 text-slate-300">Choose tokens or premium access. Your award is reviewed manually.</p>
      <section className="mt-8">
        <h2 className="text-lg font-semibold">1. Choose a package</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {packages.map(pkg => {
            const premium = Boolean(pkg.premium_days);
            return <button key={pkg.id} onClick={() => setSelected(pkg.id)} className={`relative rounded-xl border p-4 text-left ${selected === pkg.id ? "border-sky-300 bg-sky-950/50" : "border-white/15 bg-slate-950/70"}`}>
              {bestValue === pkg.id && <span className="absolute right-3 top-3 rounded-full bg-amber-300 px-2 py-1 text-xs font-bold text-slate-950">Best value</span>}
              <p className="text-2xl font-semibold">KSh {pkg.price_ksh}</p>
              <p className="mt-2">{premium ? "3 months premium" : `${pkg.tokens?.toLocaleString()} tokens`}</p>
              <p className="mt-1 text-sm text-slate-300">{premium ? "Premium answers" : `${Math.floor((pkg.tokens ?? 0) / 5)} messages`}</p>
            </button>;
          })}
        </div>
      </section>
      <section className="mt-8 rounded-xl border border-white/15 bg-slate-950/70 p-5">
        <h2 className="text-lg font-semibold">2. Pay by M-Pesa</h2>
        <p className="mt-2 text-slate-300">Send the exact package amount to this till:</p>
        <div className="mt-3 flex items-center gap-3">
          <strong className="text-3xl tracking-widest">{till || "—"}</strong>
          <button onClick={() => void navigator.clipboard.writeText(till)} disabled={!till} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Copy</button>
        </div>
        <h2 className="mt-6 text-lg font-semibold">3. Enter the M-Pesa transaction code</h2>
        <input value={code} onChange={event => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setError(""); }} maxLength={10} placeholder="ABC1234567" className="mt-3 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-3 text-white" />
        <p className="mt-1 text-xs text-slate-300">Exactly 10 letters or numbers. Spaces and symbols are removed.</p>
        <h2 className="mt-6 text-lg font-semibold">4. Submit your request</h2>
        <button onClick={() => void submit()} disabled={submitting || selected === null} className="mt-3 rounded-lg bg-white px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">{submitting ? "Sending..." : "Send token award request"}</button>
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-300/30 bg-red-950/70 p-3 text-red-100">{error}</p>}
        {confirmation && <p role="status" className="mt-3 rounded-lg border border-emerald-300/30 bg-emerald-950/70 p-3 text-emerald-100">{confirmation}</p>}
      </section>
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Your requests</h2>
        <div className="mt-3 space-y-2">
          {requests.map(request => <div key={request.id} className="rounded-lg border border-white/15 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-semibold">{request.package} · KSh {request.amount_ksh}</p><p className="text-sm text-slate-300">{request.mpesa_code} · {new Date(request.created_at).toLocaleString()}</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${request.status === "approved" ? "bg-emerald-300 text-slate-950" : request.status === "rejected" ? "bg-red-300 text-slate-950" : "bg-amber-300 text-slate-950"}`}>{request.status}</span>
            </div>
            {request.status === "rejected" && request.reject_reason && <p className="mt-2 text-sm text-red-200">Reason: {request.reject_reason}</p>}
          </div>)}
          {requests.length === 0 && <p className="text-sm text-slate-300">No requests yet.</p>}
        </div>
      </section>
    </div>
  </div>;
}
