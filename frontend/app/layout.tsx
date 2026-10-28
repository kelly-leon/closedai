import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClosedAI",
  description: "Personal AI answers grounded in your uploaded files.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
