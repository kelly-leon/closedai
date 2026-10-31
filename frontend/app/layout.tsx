import type { Metadata } from "next";
import { AppShell } from "../components/AppShell";
import { SpaceBackground } from "../components/SpaceBackground";
import { Figtree, Fraunces } from "next/font/google";
import { AuthGuard } from "../components/AuthGuard";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"] });
import "./globals.css";

export const metadata: Metadata = {
  title: "ClosedAI",
  description: "Personal AI answers grounded in your uploaded files.",
  openGraph: {
    title: "ClosedAI",
    description: "Study smarter from your own notes with cited answers.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className={`${figtree.variable} ${fraunces.variable} h-full`}><AuthGuard><SpaceBackground /><AppShell>{children}</AppShell></AuthGuard></body>
    </html>
  );
}
