import type { CSSProperties } from "react";
import "./propeller.css";

interface PropellerProps {
  size?: number;
  speed?: number;
  spinning?: boolean;
}

export default function Propeller({
  size = 220,
  speed = 1.2,
  spinning = true,
}: PropellerProps) {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1.2;

  return (
    <div
      className={`propeller ${spinning ? "spinning" : ""}`}
      style={
        {
          width: size,
          height: size,
          "--spin-duration": `${safeSpeed}s`,
        } as CSSProperties
      }
      role="img"
      aria-label={
        spinning ? "Rotating three-blade propeller" : "Stopped three-blade propeller"
      }
    >
      <svg
        viewBox="0 0 300 300"
        width="100%"
        height="100%"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="150" cy="150" r="85" />
        <circle cx="150" cy="150" r="69" />
        <circle cx="150" cy="150" r="49" />
        <path d="M150 101 C178 108 192 126 199 150" />
        <path d="M150 199 C122 192 108 174 101 150" />
        <g className="propeller-rotor">
          {[0, 120, 240].map((angle) => (
            <g key={angle} transform={`rotate(${angle} 150 150)`}>
              <path
                d="M139 143
                   C133 119 133 75 139 39
                   C141 26 159 26 161 39
                   C167 75 167 119 161 143
                   C157 151 143 151 139 143Z"
              />
            </g>
          ))}
          <circle cx="150" cy="150" r="19" />
        </g>
        <g className="motion-lines">
          <path d="M229 111 Q245 96 251 79" />
          <path d="M239 130 Q259 126 268 115" />
          <path d="M72 205 Q57 215 52 230" />
          <path d="M76 85 Q64 74 57 62" />
          <circle cx="247" cy="178" r="3" fill="currentColor" />
          <circle cx="51" cy="127" r="3" fill="currentColor" />
          <circle cx="216" cy="53" r="2" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}
