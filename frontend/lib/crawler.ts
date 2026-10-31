export interface CrawlerEngine { resize: () => void; destroy: () => void }
export interface CrawlerResult { filename: string; page: number; score: number | null }
export interface CrawlerStatus {
  phase: "embedding" | "searching" | "reading" | "writing";
  query: string;
  results: CrawlerResult[];
  count: number;
}

export function createCrawlerEngine(
  canvas: HTMLCanvasElement,
  options: { mode: "ambient" | "search"; words: string[]; documents: string[]; status?: CrawlerStatus; reducedMotion: boolean },
): CrawlerEngine {
  if (process.env.NEXT_PUBLIC_CRAWLER === "off") return { resize: () => undefined, destroy: () => undefined };
  const ctx = canvas.getContext("2d");
  if (!ctx) return { resize: () => undefined, destroy: () => undefined };
  const context = ctx;
  const reduced = options.reducedMotion;
  const names = (options.mode === "ambient" ? ["Lecture notes", "Past papers", "Slides", "Textbook"] : options.documents).slice(0, 12);
  let width = 1;
  let height = 1;
  let frame = 0;
  let destroyed = false;
  let visible = true;
  let last = 0;
  let cloud: HTMLCanvasElement | null = null;
  let slowSince = 0;
  let slowCount = 0;
  const clusters = names.map((name, index) => ({
    name,
    angle: (index / Math.max(1, names.length)) * Math.PI * 2,
    seed: index * 17,
  }));

  function makeCloud() {
    cloud = document.createElement("canvas");
    cloud.width = canvas.width;
    cloud.height = canvas.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const off = cloud.getContext("2d");
    if (!off) return;
    off.setTransform(ratio, 0, 0, ratio, 0, 0);
    off.fillStyle = "#05090b";
    off.fillRect(0, 0, width, height);
    for (const cluster of clusters) {
      const cx = width * 0.5 + Math.cos(cluster.angle) * Math.min(width * 0.31, 260);
      const cy = height * 0.43 + Math.sin(cluster.angle) * Math.min(height * 0.24, 180);
      const count = width < 700 ? 28 : 60;
      for (let i = 0; i < count; i += 1) {
        const angle = i * 2.399 + cluster.seed;
        const radius = 12 + Math.sqrt(i / count) * 54;
        off.fillStyle = i % 9 === 0 ? "rgba(244,114,182,.55)" : "rgba(94,234,212,.38)";
        off.beginPath();
        off.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.68, i % 13 === 0 ? 1.6 : 1, 0, Math.PI * 2);
        off.fill();
      }
      off.fillStyle = "#f8fafc";
      off.font = "12px ui-monospace, SFMono-Regular, monospace";
      off.fillText(cluster.name, cx - 58, cy + 76);
      off.fillStyle = "#64748b";
      off.font = "10px ui-monospace, SFMono-Regular, monospace";
      off.fillText(options.mode === "ambient" ? "sample cluster" : "document cluster", cx - 58, cy + 92);
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.dataset.ratio = String(ratio);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    makeCloud();
  }

  function draw(time: number) {
    if (destroyed || !visible || document.hidden || reduced) return;
    const elapsed = last ? time - last : 1000 / 30;
    if (elapsed < 1000 / 30 - 2) { frame = requestAnimationFrame(draw); return; }
    last = time;
    if (elapsed > 40) {
      slowSince ||= time;
      slowCount += 1;
      if (time - slowSince >= 2000 && slowCount >= 2) { destroy(); return; }
    } else { slowSince = 0; slowCount = 0; }

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#05090b";
    context.fillRect(0, 0, width, height);
    if (cloud) context.drawImage(cloud, 0, 0, width, height);
    const hx = width / 2;
    const hy = height * 0.43;
    const pulse = 28 + Math.sin(time * 0.0018) * 3;
    context.save();
    context.shadowColor = "#2dd4bf";
    context.shadowBlur = 20;
    context.strokeStyle = "rgba(94,234,212,.9)";
    context.lineWidth = 1.5;
    context.beginPath(); context.arc(hx, hy, pulse, 0, Math.PI * 2); context.stroke();
    context.shadowBlur = 30;
    context.fillStyle = "#ecfeff";
    context.beginPath(); context.arc(hx, hy, 5 + Math.sin(time * 0.002) * 1.4, 0, Math.PI * 2); context.fill();
    context.restore();

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index];
      const cx = width * 0.5 + Math.cos(cluster.angle + time * 0.000025) * Math.min(width * 0.31, 260);
      const cy = height * 0.43 + Math.sin(cluster.angle + time * 0.000025) * Math.min(height * 0.24, 180);
      const age = (time * 0.0007 + index * 0.19) % 1;
      context.save();
      context.globalAlpha = age < 0.75 ? 0.72 : Math.max(0, 1 - (age - 0.75) / 0.25);
      context.strokeStyle = "#5eead4";
      context.shadowColor = "#2dd4bf";
      context.shadowBlur = 8;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(hx, hy);
      context.quadraticCurveTo((hx + cx) / 2, hy + (index % 2 ? -35 : 35), cx, cy);
      context.stroke();
      context.restore();
    }

    for (let index = 0; index < Math.min(options.words.length, 8); index += 1) {
      const word = options.words[index];
      const x = hx + ((index % 4) - 1.5) * 58;
      const y = hy + (index % 2 ? 48 : -48) + Math.sin(time * 0.001 + index) * 4;
      context.fillStyle = "rgba(244,114,182,.92)";
      context.fillRect(x - 22, y - 9, Math.max(44, word.length * 7), 18);
      context.fillStyle = "#fff1f7";
      context.font = "10px ui-monospace, SFMono-Regular, monospace";
      context.fillText(word.slice(0, 12), x - 17, y + 3);
    }
    canvas.dataset.mainThreadMs = String(elapsed);
    frame = requestAnimationFrame(draw);
  }

  const observer = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false;
    start();
  });
  const visibility = () => start();
  function start() {
    cancelAnimationFrame(frame);
    if (!reduced && !destroyed && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }
  observer.observe(canvas);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", resize);
  resize();
  start();

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("resize", resize);
    cloud = null;
    canvas.width = 0;
    canvas.height = 0;
  }
  return { resize, destroy };
}
