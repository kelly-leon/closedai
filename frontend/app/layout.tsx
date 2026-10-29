import type { Metadata } from "next";
import { AppShell } from "../components/AppShell";
import { SpaceBackground } from "../components/SpaceBackground";
import { Figtree } from "next/font/google";
import { AuthGuard } from "../components/AuthGuard";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
import "./globals.css";

export const metadata: Metadata = {
  title: "ClosedAI",
  description: "Personal AI answers grounded in your uploaded files.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className={`${figtree.className} h-full`}><AuthGuard><SpaceBackground /><AppShell>{children}</AppShell></AuthGuard></body>
    </html>
  );
}
