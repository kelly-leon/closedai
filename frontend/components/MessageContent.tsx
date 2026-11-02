"use client";

import { Children, cloneElement, ComponentPropsWithoutRef, isValidElement, ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Source } from "../lib/api";
import { inlineSources } from "./SourceList";
import { safeMessageText, splitQuotedMessage } from "../lib/messageContent";

function MarkdownInline({ children, sources }: { children: ReactNode; sources: Source[] | null }) {
  return <>{Children.map(children, child => {
    if (typeof child === "string") return inlineSources(child, sources);
    if (isValidElement(child)) {
      if (typeof child.type === "string" && ["br", "hr", "img", "input"].includes(child.type)) return child;
      const props = child.props as { children?: ReactNode };
      return cloneElement(child as ReactElement<{ children?: ReactNode }>, {}, <MarkdownInline sources={sources}>{props.children}</MarkdownInline>);
    }
    return child;
  })}</>;
}

export function MessageContent({ content, role, sources }: { content: string | null | undefined; role: "user" | "assistant"; sources: Source[] | null }) {
  const text = safeMessageText(content).replace(/[ \t]+\n/g, "\n").replace(/\n(?:[ \t]*\n)+/g, "\n\n");
  if (role === "user") {
    const parsed = splitQuotedMessage(text);
    return <div className="text-sm leading-relaxed">
      {parsed.quote && <blockquote className="mb-2 max-w-md border-l-2 border-slate-300/60 pl-3 text-xs text-[#a9b3c7] whitespace-pre-wrap">{parsed.quote}</blockquote>}
      <p className="whitespace-pre-wrap">{parsed.question || (text ? text : null)}</p>
    </div>;
  }

  const inline = ({ children }: ComponentPropsWithoutRef<"p">) => <p><MarkdownInline sources={sources}>{children}</MarkdownInline></p>;
  const listItem = ({ children }: ComponentPropsWithoutRef<"li">) => <li><MarkdownInline sources={sources}>{children}</MarkdownInline></li>;
  return <div className="prose prose-sm prose-slate dark:prose-invert max-w-none whitespace-pre-wrap">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        br: () => <br />,
        hr: () => <hr />,
        img: ({ src, alt }: ComponentPropsWithoutRef<"img">) => <img src={src} alt={alt} />,
        input: ({ type, checked, disabled }: ComponentPropsWithoutRef<"input">) => <input type={type} checked={checked} disabled={disabled} />,
        p: inline,
        li: listItem,
        h1: ({ children }) => <h1><MarkdownInline sources={sources}>{children}</MarkdownInline></h1>,
        h2: ({ children }) => <h2><MarkdownInline sources={sources}>{children}</MarkdownInline></h2>,
        h3: ({ children }) => <h3><MarkdownInline sources={sources}>{children}</MarkdownInline></h3>,
      }}
    >
      {text}
    </ReactMarkdown>
  </div>;
}
