import Link from "next/link";
import { OrbitScene } from "./OrbitScene";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-form-side">
        <Link href="/" className="auth-wordmark" aria-label="ClosedAI home">ClosedAI</Link>
        <div className="auth-form-wrap">{children}</div>
      </section>
      <OrbitScene />
    </main>
  );
}
