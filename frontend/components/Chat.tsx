"use client";

import { Children, cloneElement, FormEvent, isValidElement, KeyboardEvent, memo, ReactElement, ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePathname, useRouter } from "next/navigation";
import { api, Source } from "../lib/api";
import { inlineSources, SourceList } from "./SourceList";
import { ThinkingIndicator } from "./ThinkingIndicator";
import dynamic from "next/dynamic";
import { tokenizeWords } from "../lib/messageText";
import type { CrawlerStatus } from "../lib/crawler";

const CrawlerCanvas = dynamic(() => import("./crawler/CrawlerCanvas").then(module => module.CrawlerCanvas), { ssr: false });

function MarkdownInline({ children, sources }: { children: ReactNode; sources: Source[] | null }) {
  return <>{Children.map(children, child => {
    if (typeof child === "string") return inlineSources(child, sources);
    if (isValidElement(child)) return cloneElement(child as ReactElement<{ children?: ReactNode }>, {}, <MarkdownInline sources={sources}>{(child.props as { children?: ReactNode }).children}</MarkdownInline>);
    return child;
  })}</>;
}

interface DisplayMessage { id: string; role: "user" | "assistant"; content: string; sources: Source[] | null }
interface SelectionButton { text: string; left: number; top: number }

const MessageItem = memo(function MessageItem({ message, streaming }: { message: DisplayMessage; streaming: boolean }) {
  const parsed = message.role === "user" ? splitQuotedMessage(message.content) : null;
  return <article className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
    <div className={`max-w-[85%] px-2 py-2 ${message.role === "user" ? "rounded-2xl bg-white/15 text-white backdrop-blur-md" : "w-full max-w-3xl text-slate-100"}`}>
      {message.role === "assistant" ? <div data-assistant-message className="prose prose-sm prose-slate dark:prose-invert max-w-none leading-7"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{p: ({children}) => <p><MarkdownInline sources={message.sources}>{children}</MarkdownInline></p>, li: ({children}) => <li><MarkdownInline sources={message.sources}>{children}</MarkdownInline></li>, h1: ({children}) => <h1><MarkdownInline sources={message.sources}>{children}</MarkdownInline></h1>, h2: ({children}) => <h2><MarkdownInline sources={message.sources}>{children}</MarkdownInline></h2>, h3: ({children}) => <h3><MarkdownInline sources={message.sources}>{children}</MarkdownInline></h3>}}>{message.content}</ReactMarkdown></div> : parsed && <div className="text-sm leading-relaxed">{parsed.quote && <blockquote className="mb-2 max-w-md border-l-2 border-slate-300/60 pl-3 text-xs text-[#a9b3c7] whitespace-pre-wrap">{parsed.quote}</blockquote>}<p className="whitespace-pre-wrap">{parsed.question}</p></div>}
      {message.role === "assistant" && !streaming && <SourceList sources={message.sources} />}
    </div>
  </article>;
});

function splitQuotedMessage(content: string): { quote: string | null; question: string } {
  if (!content.startsWith("> ")) return { quote: null, question: content };
  const lines = content.split("\n");
  const quoted: string[] = [];
  let index = 0;
  while (index < lines.length && lines[index].startsWith("> ")) {
    quoted.push(lines[index].slice(2));
    index += 1;
  }
  while (index < lines.length && lines[index] === "") index += 1;
  return { quote: quoted.join("\n") || null, question: lines.slice(index).join("\n") };
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
  const router = useRouter();
  const pathname = usePathname();
  const [activeConversation, setActiveConversation] = useState(conversationId);
  const [quote, setQuote] = useState<string | null>(null);
  const [selectionButton, setSelectionButton] = useState<SelectionButton | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [workingStatus, setWorkingStatus] = useState<string | undefined>(undefined);
  const [searchWords, setSearchWords] = useState<string[]>([]);
  const [crawlerVisible, setCrawlerVisible] = useState(false);
  const [crawlerStatus, setCrawlerStatus] = useState<CrawlerStatus | undefined>();
  const [crawlerDocuments, setCrawlerDocuments] = useState<string[]>([]);
  const streamBuffer = useRef("");
  const streamFrame = useRef<number | null>(null);

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
        content: item.content,
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
      setMessages([]); setInput(""); setQuote(null); setSelectionButton(null); setWorkingStatus(undefined); setActiveConversation(undefined); setStreaming(false); setThinking(false); setError(null);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    };
    window.addEventListener("closedai:new-chat", reset);
    return () => window.removeEventListener("closedai:new-chat", reset);
  }, []);

  useEffect(() => {
    setActiveConversation(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (pathname === "/") inputRef.current?.focus();
  }, [pathname]);

  async function send(event?: FormEvent | string) {
    if (typeof event !== "string") event?.preventDefault();
    const override = typeof event === "string" ? event : null;
    const question = override?.trim() || input.trim() || (quote ? "Explain this" : "");
    if (!question || streaming) return;
    const message = override || (quote ? `> ${quote.slice(0, 1000).replace(/\n/g, "\n> ")}\n\n${question}` : question);
    setLastMessage(message);
    setInput(""); setQuote(null); setSelectionButton(null); setError(null); setStreaming(true);
    setThinking(true);
    setCrawlerVisible(true);
    void (async () => {
      try {
        const unitId = window.localStorage.getItem("closedai-unit-id");
        const documents = unitId ? await api.documents(unitId) : [];
        const names = documents.map(document => document.filename.replace(/\.[^.]+$/, ""));
        setCrawlerDocuments(names);
        const questionWords = tokenizeWords(question, 12);
        setSearchWords(names.length ? [...names, ...questionWords] : [...questionWords, "notes", "slides", "past papers", "answers", "sources"]);
      } catch {
        setSearchWords([...tokenizeWords(question, 12), "notes", "slides", "past papers"]);
      }
    })();
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
            setWorkingStatus(undefined);
            setCrawlerVisible(false);
            streamBuffer.current += String(record.text ?? "");
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
            setWorkingStatus(typeof record.text === "string" ? record.text : "Searching your notes...");
            if (["embedding", "searching", "reading", "writing"].includes(String(record.phase))) {
              setCrawlerStatus({
                phase: record.phase as CrawlerStatus["phase"],
                query: typeof record.query === "string" ? record.query : "",
                results: Array.isArray(record.results) ? record.results.filter((item): item is CrawlerStatus["results"][number] => Boolean(item && typeof item === "object" && typeof (item as { filename?: unknown }).filename === "string" && typeof (item as { page?: unknown }).page === "number")) : [],
                count: typeof record.count === "number" ? record.count : 0,
              });
            }
          }
          if (eventName === "sources") setMessages(current => current.map((item, index) => index === current.length - 1 ? { ...item, sources: data as Source[] } : item));
          if (eventName === "done" && typeof record.conversation_id === "string") {
            terminal = true;
            setActiveConversation(record.conversation_id);
            if (!activeConversation) {
              window.dispatchEvent(new CustomEvent("closedai:conversation-created", { detail: { id: record.conversation_id, title: message.trim().slice(0, 60) || "New conversation", created_at: new Date().toISOString() } }));
              router.push(`/chat/${record.conversation_id}`);
            }
          }
          if (eventName === "error") {
            const message = typeof record.message === "string" ? record.message : "The chat request failed.";
            setLimitReached(record.code === "limit_reached");
            terminal = true;
            setError(`I couldn't complete that: ${message}`);
            setCrawlerVisible(false);
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
      setCrawlerVisible(false);
    } finally { controller.current = null; setCrawlerVisible(false); setThinking(false); setWorkingStatus(undefined); setStreaming(false); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
      {crawlerVisible && <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden bg-slate-950/45" aria-live="polite">
        <CrawlerCanvas mode="search" words={searchWords} documents={crawlerDocuments} status={crawlerStatus} />
        <div className="absolute left-3 right-3 top-3 flex items-center gap-3 border border-white/10 bg-slate-950/80 px-3 py-2 font-mono text-[11px] text-slate-300">
          <span className="font-semibold text-teal-200">closedai-crawler</span>
          <span>{crawlerStatus?.phase ?? "embedding"}</span>
          <span className="truncate text-pink-200">{crawlerStatus?.query ?? "ambient scan"}</span>
        </div>
        <div className="absolute bottom-3 left-3 right-3 grid grid-cols-3 gap-2 font-mono text-[10px] text-slate-300">
          <section className="min-h-24 border border-white/10 bg-slate-950/85 p-2">
            <h2 className="text-white">CRAWL LOG</h2>
            <p>{crawlerStatus?.phase === "searching" ? `searching: ${crawlerStatus.query}` : `${crawlerStatus?.phase ?? "embedding"}: ambient scan`}</p>
            {crawlerStatus?.results.map(result => <p key={`${result.filename}-${result.page}`} className="truncate">found 1 in {result.filename}, page {result.page}</p>)}
          </section>
          <section className="border border-white/10 bg-slate-950/85 p-2">
            <h2 className="text-white">DOCUMENTS</h2>
            {crawlerDocuments.map(filename => {
              const count = crawlerStatus?.results.filter(result => result.filename === filename || result.filename.replace(/\.[^.]+$/, "") === filename).length ?? 0;
              return <div key={filename} className="mt-1"><div className="flex justify-between"><span className="truncate">{filename}</span><span>{count}</span></div><div className="h-px bg-white/10"><div className="h-px bg-teal-300" style={{ width: `${count ? Math.min(100, 100 / Math.max(1, count)) : 0}%` }} /></div></div>;
            })}
          </section>
          <section className="border border-white/10 bg-slate-950/85 p-2">
            <h2 className="text-white">MATCHES</h2>
            {crawlerDocuments.map(filename => {
              const count = crawlerStatus?.results.filter(result => result.filename === filename || result.filename.replace(/\.[^.]+$/, "") === filename).length ?? 0;
              return count > 0 ? <div key={filename} className="mt-1 flex items-center gap-2"><span className="w-20 truncate">{filename}</span><div className="h-1 flex-1 bg-white/10"><div className="h-1 bg-pink-300" style={{ width: `${Math.min(100, count * 20)}%` }} /></div></div> : null;
            })}
          </section>
        </div>
      </div>}
      <div className="mx-auto max-w-3xl space-y-5">
        {loading && <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />}
        {!loading && messages.length === 0 && <div className="py-20 text-center"><h1 className="text-2xl font-semibold">What are we exploring?</h1><p className="mt-2 rounded-md bg-slate-950/70 px-3 py-1.5 text-slate-200 [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)]">Ask a question grounded in your uploaded documents.</p></div>}
        {messages.map(message => <MessageItem key={message.id} message={message} streaming={streaming} />)}
        {streaming && thinking && <ThinkingIndicator status={workingStatus} />}
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
      <div className="flex items-end gap-2 rounded-[28px] border border-white/10 bg-slate-950/80 p-2 shadow-lg backdrop-blur-xl">
        <textarea ref={inputRef} aria-label="Message" rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={onKeyDown} disabled={streaming} placeholder="Ask your documents…" className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-[#e8ecf4] outline-none placeholder:text-[#a9b3c7] disabled:opacity-60" />
        {streaming ? <button type="button" onClick={() => { setCrawlerVisible(false); controller.current?.abort(); }} aria-label="Stop response" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg text-white">■</button> : <button type="submit" disabled={!input.trim() && !quote} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl text-slate-950 disabled:opacity-40">↑</button>}
      </div>
      </div>
    </form>
  </div>;
}
