import { useRef } from "react";
import { Moon, Sun } from "lucide-react";

/** iOS-style liquid-glass pill. Matte, no bloom. */
export function LiquidGlassThemeToggle({
  theme,
  onThemeChange,
}: {
  theme: "light" | "dark";
  onThemeChange: (t: "light" | "dark") => void;
}) {
  const track = useRef<HTMLButtonElement>(null);
  const dark = theme === "dark";

  function setFromClientX(x: number) {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onThemeChange(x < r.left + r.width / 2 ? "light" : "dark");
  }

  return (
    <button
      ref={track}
      type="button"
      className={`glass-toggle ${dark ? "dark" : "light"}`}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      onClick={() => onThemeChange(dark ? "light" : "dark")}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerUp={(e) => setFromClientX(e.clientX)}
    >
      <span className="glass-icon sun" aria-hidden>
        <Sun size={13} strokeWidth={2.2} />
      </span>
      <span className="glass-icon moon" aria-hidden>
        <Moon size={13} strokeWidth={2.2} />
      </span>
      <span className="glass-thumb" aria-hidden />
    </button>
  );
}
