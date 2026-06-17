"use client";
import React from "react";

/* ── hand-drawn wobble filters (referenced by CSS: filter: url(#wobble)) ────── */
export function Filters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id="wobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="wobble-soft">
          <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

const OUT = { fill: "none", stroke: "var(--ink)", strokeWidth: 3.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/* ── SEO — magnifier over a page ────────────────────────────────────────────── */
export function IconMagnifier() {
  return (
    <svg width="58" height="58" viewBox="0 0 64 64" aria-hidden>
      <rect x="10" y="8" width="34" height="44" rx="4" {...OUT} fill="var(--cream)" />
      <line x1="17" y1="18" x2="37" y2="18" {...OUT} strokeWidth={3} />
      <line x1="17" y1="26" x2="32" y2="26" {...OUT} strokeWidth={3} />
      <line x1="17" y1="34" x2="37" y2="34" {...OUT} strokeWidth={3} />
      <circle cx="38" cy="40" r="13" {...OUT} fill="var(--orange)" />
      <circle cx="38" cy="40" r="6" {...OUT} strokeWidth={3} fill="var(--cream)" />
      <line x1="48" y1="50" x2="58" y2="60" {...OUT} strokeWidth={5} />
    </svg>
  );
}

/* ── Speed — gauge ──────────────────────────────────────────────────────────── */
export function IconGauge() {
  return (
    <svg width="58" height="58" viewBox="0 0 64 64" aria-hidden>
      <path d="M8 44 A24 24 0 0 1 56 44" {...OUT} fill="var(--cream)" />
      <path d="M8 44 L56 44" {...OUT} />
      <line x1="32" y1="44" x2="46" y2="24" stroke="var(--tomato)" strokeWidth={5} strokeLinecap="round" />
      <circle cx="32" cy="44" r="5" fill="var(--ink)" />
      <circle cx="14" cy="42" r="2" fill="var(--green)" />
      <circle cx="22" cy="30" r="2" fill="var(--green)" />
      <circle cx="42" cy="30" r="2" fill="var(--tomato)" />
      <circle cx="50" cy="42" r="2" fill="var(--tomato)" />
    </svg>
  );
}

/* ── Security — watchful eye ─────────────────────────────────────────────────── */
export function IconEye() {
  return (
    <svg width="58" height="58" viewBox="0 0 64 64" aria-hidden>
      <path d="M6 32 Q32 10 58 32 Q32 54 6 32 Z" {...OUT} fill="var(--cream)" />
      <circle cx="32" cy="32" r="11" {...OUT} fill="var(--peri)" />
      <circle cx="32" cy="32" r="4.5" fill="var(--ink)" />
      <circle cx="36" cy="28" r="1.6" fill="var(--cream)" />
    </svg>
  );
}

/* ── On-chain receipt — share card with a sprout ────────────────────────────── */
export function IconShare() {
  return (
    <svg width="58" height="58" viewBox="0 0 64 64" aria-hidden>
      <rect x="8" y="12" width="48" height="34" rx="5" {...OUT} fill="var(--cream)" />
      <path d="M32 40 V28" {...OUT} strokeWidth={3.2} />
      <path d="M32 28 q-9 0 -9 -9 q9 0 9 9Z" {...OUT} strokeWidth={2.6} fill="var(--green)" />
      <path d="M32 31 q8 1 8 -7 q-8 -1 -8 7Z" {...OUT} strokeWidth={2.6} fill="var(--green)" />
      <circle cx="16" cy="52" r="3.4" {...OUT} strokeWidth={2.6} fill="var(--orange)" />
      <circle cx="32" cy="55" r="3.4" {...OUT} strokeWidth={2.6} fill="var(--tomato)" />
      <circle cx="48" cy="52" r="3.4" {...OUT} strokeWidth={2.6} fill="var(--peri)" />
      <path d="M19 51 L29 56 M35 56 L45 51" {...OUT} strokeWidth={2.6} />
    </svg>
  );
}

/* ── robot face — for the x402 / agents card ────────────────────────────────── */
export function IconRobot() {
  return (
    <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden>
      <rect x="12" y="16" width="40" height="34" rx="8" fill="var(--orange)" stroke="var(--paper)" strokeWidth={3.4} />
      <line x1="32" y1="8" x2="32" y2="16" stroke="var(--paper)" strokeWidth={3.4} strokeLinecap="round" />
      <circle cx="32" cy="8" r="3" fill="var(--paper)" />
      <circle cx="24" cy="32" r="5" fill="var(--ink)" />
      <circle cx="40" cy="32" r="5" fill="var(--ink)" />
      <line x1="24" y1="42" x2="40" y2="42" stroke="var(--ink)" strokeWidth={3.2} strokeLinecap="round" />
    </svg>
  );
}

/* ── the signature STAMPED SCORE SEAL ───────────────────────────────────────── */
export function ScoreSeal({ score, scanning, state, tx }: { score: number; scanning: boolean; state: "pass" | "warn" | "fail"; tx?: string }) {
  const col = state === "pass" ? "var(--pass)" : state === "warn" ? "var(--warn)" : "var(--fail)";
  return (
    <svg width="230" height="230" viewBox="0 0 230 230" className={scanning ? "" : "seal-stamp"} aria-hidden style={{ overflow: "visible" }}>
      <defs>
        <path id="topArc" d="M 33,115 A 82,82 0 0 0 197,115" />
        <path id="botArc" d="M 41,115 A 74,74 0 0 0 189,115" />
      </defs>

      {/* notary teeth ring */}
      <g style={{ transformOrigin: "115px 115px" }} className={scanning ? "seal-scan" : ""}>
        <circle cx="115" cy="115" r="104" fill="none" stroke={col} strokeWidth="3" strokeDasharray="2 9" filter="url(#wobble)" />
      </g>

      {/* double ink ring */}
      <circle cx="115" cy="115" r="95" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3.5" filter="url(#wobble)" />
      <circle cx="115" cy="115" r="88" fill="none" stroke={col} strokeWidth="2.5" filter="url(#wobble)" />

      {/* curved text */}
      <text className="mono" fontSize="12.5" fontWeight={600} letterSpacing="3.4" fill="var(--ink)">
        <textPath href="#topArc" startOffset="50%" textAnchor="middle">SITE · AUDIT · SITE · AUDIT</textPath>
      </text>
      <text className="mono" fontSize="9.5" fontWeight={500} letterSpacing="2.2" fill={col}>
        <textPath href="#botArc" startOffset="50%" textAnchor="middle">{scanning ? "SCANNING ON ARC" : "STAMPED ON-CHAIN · keccak256"}</textPath>
      </text>

      {/* star ticks */}
      <text x="115" y="58" textAnchor="middle" fontSize="13" fill={col}>★</text>
      <text x="115" y="180" textAnchor="middle" fontSize="13" fill={col}>★</text>

      {/* center score */}
      {scanning ? (
        <text x="115" y="128" textAnchor="middle" className="mono" fontSize="30" fontWeight={600} fill="var(--ink)" opacity="0.55">· · ·</text>
      ) : (
        <>
          <text x="115" y="126" textAnchor="middle" className="mono" fontSize="58" fontWeight={600} fill="var(--ink)">{score}</text>
          <text x="115" y="150" textAnchor="middle" className="mono" fontSize="13" fontWeight={500} fill="var(--ink)" opacity="0.55">OUT OF 100</text>
        </>
      )}
    </svg>
  );
}

/* ── scattered decorative Memphis shapes (purely ornamental) ─────────────────── */
export function MiniShapes() {
  const S: React.CSSProperties = { position: "fixed", zIndex: 0, pointerEvents: "none" };
  return (
    <>
      <svg className="float" style={{ ...S, top: 120, left: "7%" }} width="46" height="46" viewBox="0 0 46 46" aria-hidden>
        <path d="M23 3 L29 17 L44 18 L32 28 L36 43 L23 34 L10 43 L14 28 L2 18 L17 17 Z" fill="var(--orange)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <svg className="float" style={{ ...S, top: 200, right: "8%", animationDelay: "1.2s" }} width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r="16" fill="var(--green)" stroke="var(--ink)" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="7" fill="var(--cream)" stroke="var(--ink)" strokeWidth="2.5" />
      </svg>
      <svg className="float" style={{ ...S, bottom: 150, left: "11%", animationDelay: "0.6s" }} width="50" height="30" viewBox="0 0 50 30" aria-hidden>
        <path d="M3 15 Q14 2 25 15 Q36 28 47 15" fill="none" stroke="var(--peri)" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <svg className="float" style={{ ...S, bottom: 230, right: "10%", animationDelay: "1.8s" }} width="38" height="38" viewBox="0 0 38 38" aria-hidden>
        <rect x="6" y="6" width="26" height="26" rx="4" fill="var(--tomato)" stroke="var(--ink)" strokeWidth="2.5" transform="rotate(12 19 19)" />
      </svg>
    </>
  );
}
