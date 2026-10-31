"use client";

import dynamic from "next/dynamic";

export const ORBIT_LABELS = [
  "Upload documents",
  "Ask questions",
  "Get cited answers",
  "Summarize long files",
  "Find a clause in a contract",
  "Search your notes",
  "Look up a manual",
  "Review a report",
  "Organize by project or course",
  "Prepare for exams",
] as const;

const CrawlerCanvas = dynamic(
  () => import("../crawler/CrawlerCanvas").then((module) => module.CrawlerCanvas),
  { ssr: false },
);

export function OrbitScene() {
  return (
    <aside className="auth-orbit" aria-label="What you can do on ClosedAI">
      <CrawlerCanvas mode="ambient" className="auth-orbit-crawler" />
      <div className="auth-orbit-copy">
        <p>What to do on ClosedAI</p>
        <div className="orbit-scene" aria-hidden="true">
          <div className="orbit-ring orbit-ring-inner" />
          <div className="orbit-ring orbit-ring-outer" />
          <div className="orbit-center">Your files,<br />connected.</div>
          {ORBIT_LABELS.map((label, index) => (
            <span
              key={label}
              tabIndex={0}
              className={`orbit-label orbit-label-${index < 5 ? "inner" : "outer"}`}
              style={{
                "--angle": `${(index % 5) * 72}deg`,
                "--counter-angle": `${((index % 5) * 72) * -1}deg`,
              } as React.CSSProperties}
            >
              <i />
              {label}
            </span>
          ))}
        </div>
        <ul className="sr-only">
          {ORBIT_LABELS.map((label) => <li key={label}>{label}</li>)}
        </ul>
      </div>
    </aside>
  );
}
