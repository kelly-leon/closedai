import { supabase, supabaseAuthEnabled } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface ConversationSummary { id: string; title: string; created_at: string }
export interface Source { filename: string; page: number | null; snippet: string }
export interface Message { id: string; role: "user" | "assistant"; content: string; sources: Source[] | null; created_at: string }
export interface DocumentItem { id: string; filename: string; status: "pending" | "processing" | "ready" | "failed"; error_message?: string | null }
export interface Unit { id: string; name: string }
export interface Usage { plan: string; messages_used: number | null; message_quota: number | null; documents_used: number | null; document_quota: number | null; expires_at: string | null }

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
  let response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401 && supabaseAuthEnabled) {
    if (!supabase) throw new Error("Authentication is unavailable.");
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.data.session) {
      await forceLogin();
      throw new Error("Your session expired. Please sign in again.");
    }
    headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${refreshed.data.session.access_token}`);
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (response.status === 401) {
      await forceLogin();
      throw new Error("Your session expired. Please sign in again.");
    }
  }
  if (!response.ok) {
    let detail = "Something went wrong. Please try again.";
    try {
      const body = await response.json() as { detail?: unknown; message?: string };
      const payload = body.detail ?? body;
      detail = typeof payload === "string" ? payload : typeof payload === "object" && payload && "message" in payload ? String((payload as { message: unknown }).message) : detail;
    } catch { /* friendly fallback */ }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  units: () => request<Unit[]>("/units"),
  createUnit: (name: string) => request<Unit>("/units", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  renameUnit: (id: string, name: string) => request<Unit>(`/units/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  deleteUnit: (id: string) => request<void>(`/units/${id}`, { method: "DELETE" } ),
  usage: () => request<Usage>("/me/usage"),
  redeem: (code: string) => request<Usage>("/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }),
  conversations: (unitId: string) => request<ConversationSummary[]>(`/conversations?unit_id=${encodeURIComponent(unitId)}`),
  conversation: (id: string) => request<Message[]>(`/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
  chatStream: async (message: string, conversationId: string | undefined, unitId: string, signal: AbortSignal) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    Object.entries(await authHeaders()).forEach(([key, value]) => headers.set(key, String(value)));
    let response = await fetch(`${API_URL}/chat`, { method: "POST", headers, signal, body: JSON.stringify({ message, conversation_id: conversationId ?? null, unit_id: unitId }) });
    if (response.status === 401 && supabaseAuthEnabled) {
      if (!supabase) return response;
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.data.session) { await forceLogin(); return response; }
      headers.set("Authorization", `Bearer ${refreshed.data.session.access_token}`);
      response = await fetch(`${API_URL}/chat`, { method: "POST", headers, signal, body: JSON.stringify({ message, conversation_id: conversationId ?? null, unit_id: unitId }) });
      if (response.status === 401) await forceLogin();
    }
    return response;
  },
  documents: (unitId: string) => request<DocumentItem[]>(`/documents?unit_id=${encodeURIComponent(unitId)}`),
  uploadDocument: async (file: File, unitId: string, onProgress: (progress: number) => void): Promise<{ id: string }> => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    const url = new URL(`${API_URL}/documents`);
    url.searchParams.set("unit_id", unitId);
    return new Promise((resolve, reject) => {
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText) as { id: string }) : reject(new Error(xhr.status === 401 ? "Your session expired. Please sign in again." : "Upload failed. Please try again."));
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
