"use client";

import { Component, ErrorInfo, FormEvent, KeyboardEvent, memo, ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, Source } from "../lib/api";
import { SourceList } from "./SourceList";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageContent } from "./MessageContent";
import * as Sentry from "@sentry/nextjs";
import { SoundToggle } from "./SoundToggle";
import { chatSound, SoundTokenBatch } from "../lib/sound";
import { seedQuery } from "../lib/query";
import { storeLastChat } from "../lib/lastChat";
import { ChatDocumentEmptyState } from "./ChatDocumentEmptyState";
import { REQUIRE_DOCUMENT_TO_CHAT } from "../lib/config";

interface DisplayMessage { id: string; role: "user" | "assistant"; content: string | null; sources: Source[] | null }
interface SelectionButton { text: string; left: number; top: number }

const MessageItem = memo(function MessageItem({ message, streaming }: { message: DisplayMessage; streaming: boolean }) {
  return <article className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
    <div className={`app-message ${message.role === "user" ? "app-user-message max-w-[85%]" : "app-assistant-message w-full"}`}>
      <div data-assistant-message={message.role === "assistant" ? true : undefined}>
        <MessageContent content={message.content} role={message.role} sources={message.sources} />
      </div>
      {message.role === "assistant" && !streaming && <SourceList sources={message.sources} />}
    </div>
  </article>;
});

export class MessageListErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { logMessageRenderError(error); }
  render() { return this.state.failed ? <div role="alert">This message could not be displayed</div> : this.props.children; }
}

export class MessageErrorBoundary extends Component<{ children: ReactNode; rawText: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { logMessageRenderError(error); }
  render() {
    return this.state.failed
      ? <article role="alert"><div>This message could not be displayed</div><pre className="whitespace-pre-wrap">{this.props.rawText}</pre></article>
      : this.props.children;
  }
}

function logMessageRenderError(error: Error) {
  try {
    Sentry.withScope(scope => {
      scope.clear();
      Sentry.captureException(error);
    });
  } catch {
    // Sentry is optional; rendering the safe fallback must never depend on it.
  }
}

export function Chat({ conversationId }: { conversationId?: string }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [thinking, setThinking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const [activeConversation, setActiveConversation] = useState(conversationId);
  const [quote, setQuote] = useState<string | null>(null);
  const [selectionButton, setSelectionButton] = useState<SelectionButton | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const streamBuffer = useRef("");
  const streamFrame = useRef<number | null>(null);
  const [workingPhase, setWorkingPhase] = useState<string | undefined>();
  const [unitReady, setUnitReady] = useState(false);
  const [unitId, setUnitId] = useState("");

  useEffect(() => {
    chatSound.stop();
  }, [pathname]);

  useEffect(() => {
    const refreshUnit = () => {
      const current = window.localStorage.getItem("closedai-unit-id") ?? "";
      setUnitId(current);
      setUnitReady(false);
    };
    refreshUnit();
    window.addEventListener("closedai:unit-changed", refreshUnit);
    return () => window.removeEventListener("closedai:unit-changed", refreshUnit);
  }, []);

  useEffect(() => () => {
    chatSound.unmount();
  }, []);

  useEffect(() => {
    function nodeIsInsideAssistant(node: Node | null): boolean {
      if (!node) return false;
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      return Boolean(element?.closest('[data-assistant-message]'));
    }
    function updateSelection() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setSelectionButton(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text || !nodeIsInsideAssistant(selection.anchorNode) || !nodeIsInsideAssistant(selection.focusNode)) {
        setSelectionButton(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const width = 58;
      setSelectionButton({ text, left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)), top: Math.max(8, rect.top - 38) });
    }
    const clearSelection = () => setSelectionButton(null);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { window.getSelection()?.removeAllRanges(); clearSelection(); } };
    document.addEventListener("selectionchange", updateSelection);
    document.addEventListener("mouseup", updateSelection);
    document.addEventListener("touchend", updateSelection);
    document.addEventListener("scroll", clearSelection, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("mouseup", updateSelection);
      document.removeEventListener("touchend", updateSelection);
      document.removeEventListener("scroll", clearSelection, true);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    if (!conversationId) { setLoading(false); return; }

    if (!conversationId) { setLoading(false); return; }
    setLoading(true);
    const request = new AbortController();
    api.conversation(conversationId, request.signal).then(items => {
      if (!request.signal.aborted) setMessages(items.map(item => ({
        id: item.id,
        role: item.role,
        content: item.content ?? "",
        sources: item.sources,
      })));
    }).catch(() => { if (!request.signal.aborted) setError("Could not load this conversation."); }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    const reset = () => {
      controller.current?.abort();
      controller.current = null;
      chatSound.stop();
      setMessages([]); setInput(""); setQuote(null); setSelectionButton(null); setActiveConversation(undefined); setStreaming(false); setThinking(false); setWorkingPhase(undefined); setError(null);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    };
    window.addEventListener("closedai:new-chat", reset);
    return () => window.removeEventListener("closedai:new-chat", reset);
  }, []);

  useEffect(() => {
    setActiveConversation(conversationId);
    const unitId = window.localStorage.getItem("closedai-unit-id");
    if (conversationId && unitId) storeLastChat(conversationId, unitId);
  }, [conversationId]);

  useEffect(() => {
    if (pathname === "/") inputRef.current?.focus();
  }, [pathname]);

  async function send(event?: FormEvent | string) {
    if (typeof event !== "string") event?.preventDefault();
    const override = typeof event === "string" ? event : null;
    const question = override?.trim() || input.trim() || (quote ? "Explain this" : "");
    if (!question || streaming) return;
    void chatSound.gesture();
    const message = override || (quote ? `> ${quote.slice(0, 1000).replace(/\n/g, "\n> ")}\n\n${question}` : question);
    setLastMessage(message);
    setInput(""); setQuote(null); setSelectionButton(null); setError(null); setStreaming(true);
    setThinking(true);
    setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", content: message, sources: null }, { id: crypto.randomUUID(), role: "assistant", content: "", sources: null }]);
    const abort = new AbortController(); controller.current = abort;
    let terminal = false;
    try {
      const unitId = window.localStorage.getItem("closedai-unit-id");
      if (!unitId) throw new Error("Select a unit before chatting.");
      const response = await api.chatStream(message, activeConversation, unitId, abort.signal);
      if (!response.ok) throw new Error("The chat service is unavailable. Please try again.");
      if (!response.body) throw new Error("The chat response was empty.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n"); buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n"); const eventName = lines.find(line => line.startsWith("event: "))?.slice(7) ?? "";
          const dataLine = lines.find(line => line.startsWith("data: "))?.slice(6);
          if (!dataLine) continue;
          let data: unknown; try { data = JSON.parse(dataLine) as unknown; } catch { continue; }
          const record = data as Record<string, unknown>;
          if (eventName === "token") {
            setThinking(false);
            setWorkingPhase(undefined);
            streamBuffer.current += String(record.text ?? "");
            chatSound.tokens(new SoundTokenBatch(String(record.text ?? "")));
            if (streamFrame.current === null) {
              streamFrame.current = window.requestAnimationFrame(() => {
                streamFrame.current = null;
                const text = streamBuffer.current;
                streamBuffer.current = "";
                setMessages(current => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + text } : item));
              });
            }
          }
          if (eventName === "status") {
            setThinking(true);
            setWorkingPhase(typeof record.phase === "string" ? record.phase : undefined);
          }
          if (eventName === "sources") setMessages(current => current.map((item, index) => index === current.length - 1 ? { ...item, sources: data as Source[] } : item));
          if (eventName === "done") {
            terminal = true;
            chatSound.done();
            if (typeof record.conversation_id === "string") {
              setActiveConversation(record.conversation_id);
              if (!activeConversation) {
                window.history.replaceState(null, "", `/chat/${record.conversation_id}`);
                const unitId = window.localStorage.getItem("closedai-unit-id");
                if (unitId) storeLastChat(record.conversation_id, unitId);
                setMessages(current => {
                  seedQuery(`conversation:${record.conversation_id}`, current.map(item => ({ id: item.id, role: item.role, content: item.content ?? "", sources: item.sources })));
                  return current;
                });
                window.dispatchEvent(new CustomEvent("closedai:conversation-created", { detail: { id: record.conversation_id, title: message.trim().slice(0, 60) || "New conversation", created_at: new Date().toISOString() } }));
              }
            }
          }
          if (eventName === "error") {
            const message = typeof record.message === "string" ? record.message : "The chat request failed.";
            setLimitReached(record.code === "limit_reached");
            terminal = true;
            setError(`I couldn't complete that: ${message}`);
            chatSound.error();
          }
        }
        if (done) break;
      }
      if (!terminal) setError("The chat connection ended unexpectedly. Please try again.");
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        const detail = caught instanceof Error ? caught.message : "";
        setError(detail && detail !== "Failed to fetch" ? detail : "I couldn't reach ClosedAI. Check your connection and try again.");
      }
      chatSound.error();
    } finally { controller.current = null; setThinking(false); setWorkingPhase(undefined); setStreaming(false); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  return <div className="app-chat flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="app-chat-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {loading && <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />}
        {!loading && messages.length === 0 && unitId && (!unitReady ? <ChatDocumentEmptyState onReady={() => { setUnitReady(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} /> : <div className="py-20 text-center"><h1 className="text-2xl font-semibold">What are we exploring?</h1><p className="mt-2 rounded-md bg-slate-950/70 px-3 py-1.5 text-slate-200 [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">Ask a question grounded in your uploaded documents.</p></div>)}
        <MessageListErrorBoundary>
          {messages.map(message => <MessageErrorBoundary key={message.id} rawText={message.content ?? ""}><MessageItem message={message} streaming={streaming} /></MessageErrorBoundary>)}
        </MessageListErrorBoundary>
        {streaming && thinking && <ThinkingIndicator phase={workingPhase} />}
        {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-300/30 bg-red-950/80 px-4 py-3 text-sm text-red-100 backdrop-blur"><span>{error}</span>{lastMessage && <button type="button" onClick={() => void send(lastMessage)} disabled={streaming} className="shrink-0 rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/15">Retry</button>}</div>}
        {limitReached && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/40 bg-amber-950/85 px-4 py-3 text-sm text-white backdrop-blur"><span>You’ve reached your current allowance. Add tokens to keep chatting.</span><a href="/upgrade" className="shrink-0 rounded-full bg-white px-3 py-1 font-semibold text-slate-950">Upgrade</a></div>}
        <div ref={bottom} />
      </div>
    </div>
    {selectionButton && <button type="button" onClick={() => { setQuote(selectionButton.text.slice(0, 1000)); window.getSelection()?.removeAllRanges(); setSelectionButton(null); window.setTimeout(() => inputRef.current?.focus(), 0); }} className="fixed z-[60] rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-[#e8ecf4] shadow-lg ring-1 ring-white/20" style={{ left: selectionButton.left, top: selectionButton.top }} aria-label="Reply to selected text">Reply</button>}
    <form onSubmit={send} className="shrink-0 p-3 md:p-5">
      <div className="mx-auto max-w-3xl">
      {quote && <div className="mb-2 flex items-start gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-[#a9b3c7] backdrop-blur">
        <span aria-hidden="true" className="mt-0.5 text-[#e8ecf4]">↩</span>
        <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap">{quote}</p>
        <button type="button" onClick={() => setQuote(null)} className="text-base leading-none text-[#e8ecf4]" aria-label="Remove quoted text">×</button>
      </div>}
      {!unitReady && <p className="mb-2 text-xs text-slate-300">Answers work best once you've uploaded your files.</p>}
      <div className="app-composer flex items-end gap-2">
        <textarea ref={inputRef} aria-label="Message" rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={onKeyDown} disabled={streaming || (REQUIRE_DOCUMENT_TO_CHAT && !unitReady)} placeholder={REQUIRE_DOCUMENT_TO_CHAT && !unitReady ? "Upload a document to start chatting" : "Ask your documents…"} className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 outline-none disabled:opacity-60" />
        <SoundToggle />
        {streaming ? <button type="button" onClick={() => { controller.current?.abort(); chatSound.stop(); setThinking(false); }} aria-label="Stop response" className="app-send flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg">■</button> : <button type="submit" disabled={!input.trim() && !quote} aria-label="Send message" className="app-send flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl disabled:opacity-40">↑</button>}
      </div>
      </div>
    </form>
  </div>;
}
