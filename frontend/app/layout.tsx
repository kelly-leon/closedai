import type { Metadata } from "next";
import { AppShell } from "../components/AppShell";
import { SpaceBackground } from "../components/SpaceBackground";
import { Figtree, Fraunces } from "next/font/google";
import { AuthGuard } from "../components/AuthGuard";
import { ServerWakeBanner } from "../components/ServerWakeBanner";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"] });
import "./globals.css";
import "./marketing-tokens.css";

export const metadata: Metadata = {
  title: "ClosedAI — Ask anything about your own files",
  description: "Ask questions of your documents, notes, reports, manuals and contracts with cited answers from ClosedAI.",
  openGraph: {
    title: "ClosedAI",
    description: "Ask anything about your own files and get cited answers.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className={`${figtree.variable} ${fraunces.variable} h-full`}><AuthGuard><SpaceBackground /><ServerWakeBanner /><AppShell>{children}</AppShell></AuthGuard></body>
    </html>
  );
}
