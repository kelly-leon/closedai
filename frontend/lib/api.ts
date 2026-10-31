import { supabase, supabaseAuthEnabled } from "./supabase";
import { sharedGet, invalidateShared } from "./sharedData";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, public readonly retryable = false, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ConversationSummary { id: string; title: string; created_at: string }
export interface Source { filename: string; page: number | null; snippet: string }
export interface Message { id: string; role: "user" | "assistant"; content: string; sources: Source[] | null; created_at: string }
export interface DocumentItem { id: string; filename: string; status: "pending" | "processing" | "ready" | "failed"; error_message?: string | null }
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
export interface AdminRequest { id: string; email: string; full_name?: string | null; package: string; amount_ksh: number; mpesa_code: string; created_at: string }
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
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("We couldn't reach ClosedAI. Check your connection and try again.", true);
  }
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
    if (response.status >= 500) throw new ApiError("ClosedAI is having trouble right now. Please try again.", true);
    let detail = "Something went wrong. Please try again.";
    let structuredPayload: unknown;
    try {
      const body = await response.json() as { detail?: unknown; message?: string };
      const payload = body.detail ?? body;
      structuredPayload = payload;
      detail = typeof payload === "string" ? payload : typeof payload === "object" && payload && "message" in payload ? String((payload as { message: unknown }).message) : detail;
    } catch { /* friendly fallback */ }
    const code = typeof structuredPayload === "object" && structuredPayload && "code" in structuredPayload ? String((structuredPayload as { code: unknown }).code) : undefined;
    throw new ApiError(detail, false, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  billingPackages: () => request<{ packages: BillingPackage[]; till_number: string; message: string }>("/billing/packages"),
  paymentRequests: () => request<BillingRequest[]>("/billing/requests"),
  submitPayment: (packageId: number, mpesaCode: string) => request<{ id: string; status: string }>("/billing/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_id: packageId, mpesa_code: mpesaCode }) }),
  adminMe: () => request<{ is_admin: boolean }>("/admin/me"),
  adminRequests: (status: string) => request<AdminRequest[]>(`/admin/requests?status=${encodeURIComponent(status)}`),
  approvePayment: (id: string) => request<{ status: string }>(`/admin/requests/${id}/approve`, { method: "POST" }),
  rejectPayment: (id: string, reason: string) => request<{ status: string }>(`/admin/requests/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
  adminGrant: (email: string, tokens: number, premiumDays: number, note: string) => request<{ status: string }>("/admin/grant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, tokens, premium_days: premiumDays, note }) }),
  adminUsageSummary: () => request<{ last_7_days: UsageSummary; last_30_days: UsageSummary }>("/admin/usage-summary"),
  units: () => sharedGet("units", () => request<Unit[]>("/units")),
  createUnit: (name: string) => request<Unit>("/units", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  renameUnit: (id: string, name: string) => request<Unit>(`/units/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  deleteUnit: (id: string) => request<void>(`/units/${id}`, { method: "DELETE" } ),
  usage: () => sharedGet("usage", () => request<Usage>("/me/usage")),
  deleteAccount: () => request<{ deleted: boolean }>("/me", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE" }),
  }),
  redeem: (code: string) => request<Usage>("/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }),
  conversations: (unitId: string) => sharedGet(`conversations:${unitId}`, () => request<ConversationSummary[]>(`/conversations?unit_id=${encodeURIComponent(unitId)}`)),
  conversation: (id: string, signal?: AbortSignal) => sharedGet(`conversation:${id}`, () => request<Message[]>(`/conversations/${id}`, { signal })),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
  chatStream: async (message: string, conversationId: string | undefined, unitId: string, signal: AbortSignal) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    Object.entries(await authHeaders()).forEach(([key, value]) => headers.set(key, String(value)));
    let response = await fetch(`${API_URL}/chat`, { method: "POST", headers, signal, body: JSON.stringify({ message, conversation_id: conversationId ?? null, unit_id: unitId }) });
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
  documents: (unitId: string) => sharedGet(`documents:${unitId}`, () => request<DocumentItem[]>(`/documents?unit_id=${encodeURIComponent(unitId)}`)),
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
