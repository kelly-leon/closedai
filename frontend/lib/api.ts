import { supabase, supabaseAuthEnabled } from "./supabase";
import { fetchQuery } from "./query";
import { invalidateShared } from "./sharedData";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, public readonly retryable = false, public readonly code?: string, public readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const SERVER_WAKE_MESSAGE = "Waking the server up, this can take up to a minute on the first visit";
const RETRY_DELAYS = [1500, 3000, 6000, 10000];
const WAKEABLE_STATUSES = new Set([502, 503, 504]);
let wakingRequests = 0;

function setWaking(active: boolean) {
  wakingRequests = Math.max(0, wakingRequests + (active ? 1 : -1));
  window.dispatchEvent(new CustomEvent("closedai:server-waking", { detail: wakingRequests > 0 }));
}

export async function waitForBackend(timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  setWaking(true);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
      if (response.ok) { setWaking(false); return true; }
    } catch { /* Backend is still cold-starting. */ }
    await delay(Math.min(3000, deadline - Date.now()));
  }
  setWaking(false);
  return false;
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = window.setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function methodOf(init: RequestInit): string {
  return (init.method ?? "GET").toUpperCase();
}

function isProtectedNonIdempotent(path: string, init: RequestInit) {
  const method = methodOf(init);
  return (method === "POST" && /^(\/chat|\/billing\/requests|\/documents(?:\/|$))/.test(path))
    || (method === "DELETE" && /^\/me(?:\/|$)/.test(path));
}

export interface ConversationSummary { id: string; title: string; created_at: string }
export interface BootstrapData { units: Unit[]; usage: Usage; conversations: ConversationSummary[]; admin: boolean }
export interface Source { filename: string; page: number | null; snippet: string }
export interface Message { id: string; role: "user" | "assistant"; content: string | null; sources: Source[] | null; created_at: string }
export interface DocumentItem { id: string; filename: string; status: "pending" | "processing" | "ready" | "failed"; error_message?: string | null; chunks_done?: number; chunks_total?: number }
export interface Unit { id: string; name: string }
export interface Usage {
  plan: string;
  tokens_available?: number | null; trial_tokens_remaining?: number | null; trial_resets_at?: string | null;
  token_balance?: number | null; premium_until?: string | null; daily_used?: number | null; daily_cap?: number | null;
  documents_used: number | null; document_quota: number | null;
  messages_used: number | null; message_quota: number | null; expires_at: string | null;
}
export interface BillingPackage { id: number; name: string; price_ksh: number; tokens: number | null; premium_days: number | null }
export interface BillingRequest { id: string; status: "pending" | "approved" | "rejected"; package: string; amount_ksh: number; mpesa_code: string; created_at: string; reject_reason?: string | null }
export interface AdminRequest { id: string; email: string; full_name?: string | null; package: string; amount_ksh: number; mpesa_code: string; created_at: string; notify_status?: string | null }
export interface UsageSummary { answers: number; average_input_tokens: number; average_output_tokens: number; per_model: Record<string, number> }

async function accessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!supabaseAuthEnabled) return window.localStorage.getItem("closedai_token");
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function forceLogin(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
  window.localStorage.removeItem("closedai-unit-id");
  window.location.assign("/login");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let headers = new Headers(init.headers);
  Object.entries(await authHeaders()).forEach(([key, value]) => headers.set(key, String(value)));
  const protectedPost = isProtectedNonIdempotent(path, init);
  const attempts = protectedPost ? 1 : RETRY_DELAYS.length + 1;
  let response: Response | undefined;
  let waking = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      response = await fetch(`${API_URL}${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (!protectedPost && await waitForBackend()) {
        continue;
      }
      throw new ApiError("We couldn't reach ClosedAI. Check your connection and try again.", true);
    }
    if (!WAKEABLE_STATUSES.has(response.status)) break;
    if (protectedPost) break;
    if (await waitForBackend()) continue;
  }
  if (waking) setWaking(false);
  if (!response) throw new ApiError("We couldn't reach ClosedAI. Check your connection and try again.", true);
  if (response.status === 401 && supabaseAuthEnabled) {
    if (!supabase) throw new ApiError("Authentication is unavailable.");
    let refreshed: Awaited<ReturnType<typeof supabase.auth.refreshSession>>;
    try {
      refreshed = await supabase.auth.refreshSession();
    } catch {
      throw new ApiError("We couldn't refresh your session. Please try again.", true);
    }
    if (!refreshed.data.session || refreshed.error) {
      await forceLogin();
      throw new ApiError("Your session expired. Please sign in again.");
    }
    headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${refreshed.data.session.access_token}`);
    try {
      response = await fetch(`${API_URL}${path}`, { ...init, headers });
    } catch {
      throw new ApiError("We couldn't reach ClosedAI. Check your connection and try again.", true);
    }
    if (response.status === 401) {
      await forceLogin();
      throw new ApiError("Your session expired. Please sign in again.");
    }
  }
  if (!response.ok) {
    let detail = response.status >= 500 ? "ClosedAI is having trouble right now. Please try again." : "Something went wrong. Please try again.";
    let structuredPayload: unknown;
    let requestId = response.headers.get("X-Request-ID") ?? undefined;
    try {
      const body = await response.json() as { detail?: unknown; message?: string; request_id?: string };
      if (!requestId) requestId = body.request_id;
      const payload = body.detail ?? body;
      structuredPayload = payload;
      detail = typeof payload === "string" ? payload : typeof payload === "object" && payload && "message" in payload ? String((payload as { message: unknown }).message) : detail;
    } catch { /* friendly fallback */ }
    const code = typeof structuredPayload === "object" && structuredPayload && "code" in structuredPayload ? String((structuredPayload as { code: unknown }).code) : undefined;
    throw new ApiError(detail, response.status >= 500, code, requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  billingPackages: () => request<{ packages: BillingPackage[]; till_number: string; message: string }>("/billing/packages"),
  paymentRequests: () => fetchQuery("billing:requests", () => request<BillingRequest[]>("/billing/requests")),
  submitPayment: (packageId: number, mpesaCode: string) => request<{ id: string; status: string }>("/billing/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_id: packageId, mpesa_code: mpesaCode }) }),
  adminMe: () => request<{ is_admin: boolean; notifier_configured: boolean; mailer_configured?: boolean; mail_provider?: "smtp" | "apps_script" | "none"; mailer_status?: { provider: string; enabled: boolean; missing: string[]; hints: string[] } }>("/admin/me"),
  adminRequests: (status: string) => request<AdminRequest[]>(`/admin/requests?status=${encodeURIComponent(status)}`),
  approvePayment: (id: string) => request<{ status: string }>(`/admin/requests/${id}/approve`, { method: "POST" }),
  rejectPayment: (id: string, reason: string) => request<{ status: string }>(`/admin/requests/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
  adminGrant: (email: string, tokens: number, premiumDays: number, note: string, notifyUser = true) => request<{ status: string }>("/admin/grant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, tokens, premium_days: premiumDays, note, notify_user: notifyUser }) }),
  resendPaymentEmail: (id: string) => request<{ status: string }>(`/admin/requests/${id}/resend-email`, { method: "POST" }),
  adminEmailTest: () => request<{ provider: string; ok: boolean; error: string; remaining?: number }>("/admin/email-test"),
  adminUsageSummary: () => request<{ last_7_days: UsageSummary; last_30_days: UsageSummary }>("/admin/usage-summary"),
  units: () => fetchQuery("units", () => request<Unit[]>("/units")),
  createUnit: (name: string) => request<Unit>("/units", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  renameUnit: (id: string, name: string) => request<Unit>(`/units/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  deleteUnit: (id: string) => request<void>(`/units/${id}`, { method: "DELETE" } ),
  bootstrap: (unitId?: string) => request<BootstrapData>(`/me/bootstrap${unitId ? `?unit_id=${encodeURIComponent(unitId)}` : ""}`),
  usage: () => fetchQuery("usage", () => request<Usage>("/me/usage")),
  deleteAccount: () => request<{ deleted: boolean }>("/me", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE" }),
  }),
  redeem: (code: string) => request<Usage>("/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }),
  conversations: (unitId: string) => fetchQuery(`conversations:${unitId}`, () => request<ConversationSummary[]>(`/conversations?unit_id=${encodeURIComponent(unitId)}`)),
  conversation: (id: string, signal?: AbortSignal) => fetchQuery(`conversation:${id}`, () => request<Message[]>(`/conversations/${id}`, { signal })),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
  chatStream: async (message: string, conversationId: string | undefined, unitId: string, signal: AbortSignal) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    Object.entries(await authHeaders()).forEach(([key, value]) => headers.set(key, String(value)));
    const body = JSON.stringify({ message, conversation_id: conversationId ?? null, unit_id: unitId });
    let response: Response;
    try {
      response = await fetch(`${API_URL}/chat`, { method: "POST", headers, signal, body });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw new Error("We couldn't reach ClosedAI.");
    }
    if (response.status === 401 && supabaseAuthEnabled) {
      if (!supabase) return response;
      let refreshed: Awaited<ReturnType<typeof supabase.auth.refreshSession>>;
      try {
        refreshed = await supabase.auth.refreshSession();
      } catch {
        return response;
      }
      if (!refreshed.data.session || refreshed.error) { await forceLogin(); return response; }
      headers.set("Authorization", `Bearer ${refreshed.data.session.access_token}`);
      try {
        response = await fetch(`${API_URL}/chat`, { method: "POST", headers, signal, body: JSON.stringify({ message, conversation_id: conversationId ?? null, unit_id: unitId }) });
      } catch {
        return response;
      }
      if (response.status === 401) await forceLogin();
    }
    return response;
  },
  documents: (unitId: string) => fetchQuery(`documents:${unitId}`, () => request<DocumentItem[]>(`/documents?unit_id=${encodeURIComponent(unitId)}`)),
  uploadDocumentUrl: (file: File, unitId: string) => request<{ upload_url: string; token: string; storage_path: string }>("/documents/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size_bytes: file.size, mime_type: file.type || "application/octet-stream", unit_id: unitId }),
  }),
  uploadSignedDocument: (uploadUrl: string, file: File, onProgress: (progress: number) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The file could not be uploaded to storage. Please try again."));
      xhr.onerror = () => reject(new Error("The file could not be uploaded to storage. Please try again."));
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.send(file);
    }),
  registerHostedDocument: (storagePath: string, file: File, unitId: string) => request<{ id: string }>("/documents/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storage_path: storagePath, filename: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, unit_id: unitId }),
  }),
  uploadDocument: async (file: File, unitId: string, onProgress: (progress: number) => void): Promise<{ id: string }> => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    const url = new URL(`${API_URL}/documents`);
    url.searchParams.set("unit_id", unitId);
    return new Promise((resolve, reject) => {
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { resolve(JSON.parse(xhr.responseText) as { id: string }); return; }
        let message = "Upload failed. Please try again.";
        try {
          const body = JSON.parse(xhr.responseText) as { detail?: unknown; message?: string };
          const detail = body.detail ?? body;
          if (typeof detail === "string") message = detail;
          else if (detail && typeof detail === "object" && "message" in detail) message = String((detail as { message: unknown }).message);
        } catch { /* Use the friendly upload fallback. */ }
        reject(new Error(xhr.status === 401 ? "Your session expired. Please sign in again." : message));
      };
      xhr.onerror = () => reject(new Error("Upload failed. Please check your connection."));
      xhr.open("POST", url.toString());
      void accessToken().then(token => {
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(form);
      });
    });
  },
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: "DELETE" }),
  retryDocument: (id: string) => request<{ id: string; status: string }>(`/documents/${id}/retry`, { method: "POST" }),
};
