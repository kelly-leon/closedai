export interface CrawlerWord {
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  hit: boolean;
}

export interface CrawlerEngine { resize: () => void; destroy: () => void }

export function createCrawlerEngine(
  canvas: HTMLCanvasElement,
  options: { mode: "ambient" | "search"; words: string[]; reducedMotion: boolean },
): CrawlerEngine {
  const context = canvas.getContext("2d");
  if (!context) return { resize: () => undefined, destroy: () => undefined };
  const ctx = context;
  let width = 0;
  let height = 0;
  let frame = 0;
  let destroyed = false;
  let visible = true;
  let words: CrawlerWord[] = [];

  let onScreen = true;
  const observer = new IntersectionObserver(entries => {
    onScreen = entries[0]?.isIntersecting !== false;
    visible = onScreen;
    if (onScreen && !document.hidden && !options.reducedMotion && !destroyed) {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(draw);
    }
  });
  observer.observe(canvas);
  const sourceFallback = ["notes", "slides", "past paper", "chapter", "source", "page", "answer", "study", "lecture", "theory", "evidence"];

  function makeWords() {
    const count = width < 700 ? 300 : options.mode === "ambient" ? 600 : 520;
    const source = options.words.length ? options.words : sourceFallback;
    words = Array.from({ length: count }, (_, index) => ({
      text: source[index % source.length],
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.12,
      phase: Math.random() * Math.PI * 2,
      hit: index < Math.min(source.length, options.mode === "search" ? 12 : 4),
    }));
  }

  function drawRobot(time: number) {
    const direction = options.reducedMotion ? 0 : Math.sin(time * 0.00022);
    const x = width * (0.18 + 0.64 * (0.5 + direction * 0.5));
    const y = height * (0.43 + (options.reducedMotion ? 0 : Math.sin(time * 0.0007) * 0.08));
    const stride = options.reducedMotion ? 0 : Math.sin(time * 0.004) * 12;
    const target = words.reduce((nearest, word) => {
      return Math.hypot(word.x - x, word.y - y) < Math.hypot(nearest.x - x, nearest.y - y) ? word : nearest;
    }, words[0] ?? { x, y, text: "" });

    ctx.save();
    ctx.strokeStyle = "rgba(153, 246, 228, .78)";
    ctx.fillStyle = "#d9fafa";
    ctx.shadowColor = "#67e8f9";
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y - 72, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 51); ctx.lineTo(x, y + 26); ctx.stroke();
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(x, y - 36 + i * 13, 25 - i * 2, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }
    const joints = [
      [x, y - 72], [x, y - 48], [x, y - 10], [x, y + 26],
      [x - 34, y - 18], [x + 34, y - 18], [x - 20, y + 76], [x + 20, y + 76],
    ];
    for (const [jx, jy] of joints) {
      ctx.beginPath(); ctx.arc(jx, jy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 48); ctx.lineTo(x - 34, y - 18); ctx.lineTo(x - 48 + stride, y + 18); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 48); ctx.lineTo(x + 34, y - 18); ctx.lineTo(x + 48 - stride, y + 18); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 26); ctx.lineTo(x - 20, y + 76); ctx.lineTo(x - 30 + stride, y + 105); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 26); ctx.lineTo(x + 20, y + 76); ctx.lineTo(x + 30 - stride, y + 105); ctx.stroke();
    ctx.restore();

    if (target) {
      ctx.save();
      ctx.strokeStyle = "rgba(244, 114, 182, .42)";
      ctx.setLineDash([3, 8]);
      ctx.beginPath(); ctx.moveTo(x, y - 72);
      ctx.quadraticCurveTo((x + target.x) / 2, Math.min(y, target.y) - 40, target.x, target.y); ctx.stroke();
      ctx.restore();
    }
  }

  function draw(time: number) {
    if (destroyed) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#05090b"; ctx.fillRect(0, 0, width, height);
    for (const word of words) {
      if (!options.reducedMotion) {
        word.x += word.vx; word.y += word.vy;
        if (word.x < -30) word.x = width + 20;
        if (word.x > width + 30) word.x = -20;
        if (word.y < -20) word.y = height + 20;
        if (word.y > height + 20) word.y = -20;
      }
      ctx.save();
      ctx.globalAlpha = word.hit ? 0.62 : 0.19;
      ctx.fillStyle = word.hit ? "#f9a8d4" : "#b8cbd0";
      ctx.font = `${word.hit ? 14 : 11}px ui-monospace, SFMono-Regular, monospace`;
      ctx.fillText(word.text, word.x, word.y + Math.sin(time * 0.001 + word.phase) * 2);
      ctx.restore();
    }
    drawRobot(time);
    if (!options.reducedMotion && visible && !document.hidden) frame = window.requestAnimationFrame(draw);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    makeWords(); draw(0);
  }

  const visibility = () => {
    visible = !document.hidden && onScreen;
    if (visible && !options.reducedMotion && !destroyed) frame = window.requestAnimationFrame(draw);
  };
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", visibility);
  resize();
  if (!options.reducedMotion) frame = window.requestAnimationFrame(draw);
  return {
    resize,
    destroy: () => {
      destroyed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
