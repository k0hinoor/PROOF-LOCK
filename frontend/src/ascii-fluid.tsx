import { useEffect, useRef } from "react";

/** Matte ASCII ink field. Mouse stirs density; nothing glows. */
export default function AsciiFluid() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const glyphs = " .:-=+*#%@";
    let cols = 0;
    let rows = 0;
    let dens: Float32Array = new Float32Array(0);
    let next: Float32Array = new Float32Array(0);
    let raf = 0;
    const mouse = { x: 0, y: 0, px: 0, py: 0, down: false };
    let cellW = 9;
    let cellH = 14;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cellW = 9;
      cellH = 14;
      cols = Math.max(24, Math.ceil(w / cellW));
      rows = Math.max(16, Math.ceil(h / cellH));
      dens = new Float32Array(cols * rows);
      next = new Float32Array(cols * rows);
    };

    const splat = (cx: number, cy: number, amount: number) => {
      const gx = Math.floor(cx / cellW);
      const gy = Math.floor(cy / cellH);
      const rad = 4;
      for (let y = gy - rad; y <= gy + rad; y++) {
        for (let x = gx - rad; x <= gx + rad; x++) {
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const d = Math.hypot(x - gx, y - gy);
          if (d > rad) continue;
          dens[y * cols + x] = Math.min(1, dens[y * cols + x] + amount * (1 - d / rad));
        }
      }
    };

    const step = () => {
      if (!reduce) {
        for (let y = 1; y < rows - 1; y++) {
          for (let x = 1; x < cols - 1; x++) {
            const i = y * cols + x;
            const spread =
              (dens[i - 1] + dens[i + 1] + dens[i - cols] + dens[i + cols]) * 0.2 +
              dens[i] * 0.18;
            next[i] = spread * 0.92;
          }
        }
        const tmp = dens;
        dens = next;
        next = tmp;
        next.fill(0);
      }

      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--fluid-ink")
        .trim() || "#050506";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = "12px ui-monospace, Cascadia Mono, Consolas, monospace";
      ctx.textBaseline = "top";
      const ink = getComputedStyle(document.documentElement)
        .getPropertyValue("--fluid-glyph")
        .trim() || "#3a3348";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = dens[y * cols + x];
          if (v < 0.04) continue;
          const g = glyphs[Math.min(glyphs.length - 1, Math.floor(v * glyphs.length))];
          ctx.globalAlpha = 0.18 + v * 0.45;
          ctx.fillStyle = ink;
          ctx.fillText(g, x * cellW, y * cellH);
        }
      }
      ctx.globalAlpha = 1;
      raf = window.requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      mouse.px = mouse.x;
      mouse.py = mouse.y;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      const speed = Math.min(1.2, Math.hypot(mouse.x - mouse.px, mouse.y - mouse.py) / 18);
      splat(mouse.x, mouse.y, 0.22 + speed * 0.45);
    };

    resize();
    splat(window.innerWidth * 0.35, window.innerHeight * 0.4, 0.9);
    splat(window.innerWidth * 0.7, window.innerHeight * 0.55, 0.7);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(step);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className="ascii-fluid" aria-hidden="true" />;
}
