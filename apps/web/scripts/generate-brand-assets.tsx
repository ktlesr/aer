/**
 * Generates the brand raster assets from the DESIGN.md tokens:
 *
 *   public/brand/og.png        1200x628  — OG / Twitter card, doubles as the
 *                                          Google Ads "landscape image" (1.91:1)
 *   public/brand/square.png    1200x1200 — Google Ads "square image" (1:1)
 *   public/brand/logo.png      1200x1200 — Google Ads "square logo" (1:1)
 *   public/brand/icon-192.png  192x192   — web app manifest
 *   public/brand/icon-512.png  512x512   — web app manifest
 *   app/apple-icon.png         180x180   — Next `apple-icon` file convention
 *
 * Run: pnpm --filter web brand:assets   (output is committed; this is not a build step)
 *
 * ponytail: static files, not `opengraph-image.tsx` routes — the ad platforms need
 * downloadable files anyway, so rendering them per request would buy nothing.
 */
import React from "react";
import { ImageResponse } from "next/og";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(WEB_ROOT, "public", "brand");

// DESIGN.md tokens, OKLCH resolved to sRGB (satori has no OKLCH support).
const BG = "#090e14";
const SURFACE = "#10161c";
const INK = "#e4e9eb";
const MUTED = "#8a949b";
const SEAL = "#34a6b2";
const SEAL_LIGHT = "#5fc9cc";
const GOLD = "#e1c076";
const BORDER = "rgba(255,255,255,0.10)";

const SEAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <defs>
    <linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#34a6b2"/><stop offset="1" stop-color="#125b66"/>
    </linearGradient>
    <linearGradient id="h" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="M11 3 H29 L37 11 V29 L29 37 H11 L3 29 V11 Z" fill="url(#s)"/>
  <path d="M11 3 H29 L37 11 V29 L29 37 H11 L3 29 V11 Z" fill="url(#h)"/>
  <path d="M12.5 6 H27.5 L34 12.5 V27.5 L27.5 34 H12.5 L6 27.5 V12.5 Z" fill="none" stroke="#e3c277" stroke-opacity="0.55" stroke-width="0.8"/>
  <circle cx="20" cy="20" r="11" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="0.8" stroke-dasharray="1.4 2.4"/>
  <path d="M14 20.4 L18.2 24.6 L26.2 15.2" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const SEAL_URI = `data:image/svg+xml;base64,${Buffer.from(SEAL_SVG).toString("base64")}`;

const CHAIN = ["RUN STARTED", "MODEL CALL", "TOOL CALL", "REDACTION", "COMPLETED"];

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" };

/**
 * Pulls the two brand faces straight from Google Fonts as TTF. Network only runs
 * when regenerating assets; if it is unavailable we fall back to satori's built-in
 * font rather than failing the run.
 */
async function loadFonts(): Promise<Font[]> {
  const wanted: { family: string; name: string; weight: 400 | 600 }[] = [
    { family: "Fraunces:opsz,wght@9..144,600", name: "Fraunces", weight: 600 },
    { family: "IBM+Plex+Mono:wght@400", name: "IBM Plex Mono", weight: 400 },
    { family: "IBM+Plex+Sans:wght@600", name: "IBM Plex Sans", weight: 600 },
  ];
  const fonts: Font[] = [];
  for (const { family, name, weight } of wanted) {
    try {
      const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}&display=swap`, {
        // An old UA makes the API answer with TTF instead of woff2, which satori cannot read.
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" },
      }).then((r) => r.text());
      const url = css.match(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/)?.[1];
      if (!url) throw new Error("no ttf url in css");
      const data = await fetch(url).then((r) => r.arrayBuffer());
      fonts.push({ name, data, weight, style: "normal" });
    } catch (err) {
      console.warn(`! could not load ${name}, falling back to the default face:`, String(err));
    }
  }
  return fonts;
}

function Seal({ size }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={SEAL_URI} width={size} height={size} alt="" />;
}

function Grid() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `linear-gradient(${BORDER} 1px, transparent 1px), linear-gradient(90deg, ${BORDER} 1px, transparent 1px)`,
        backgroundSize: "48px 48px",
        opacity: 0.5,
      }}
    />
  );
}

function Glow({ size }: { size: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: -size * 0.35,
        right: -size * 0.25,
        width: size,
        height: size,
        borderRadius: size,
        background: `radial-gradient(circle, ${SEAL}55 0%, ${SEAL}00 65%)`,
      }}
    />
  );
}

function ChainStrip({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 * scale }}>
      {CHAIN.map((label, i) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 * scale }}>
          {i > 0 && <div style={{ width: 18 * scale, height: 1, background: BORDER }} />}
          <div
            style={{
              display: "flex",
              padding: `${7 * scale}px ${12 * scale}px`,
              borderRadius: 6 * scale,
              border: `1px solid ${label === "REDACTION" ? `${SEAL}66` : BORDER}`,
              background: label === "REDACTION" ? `${SEAL}1f` : SURFACE,
              color: label === "REDACTION" ? SEAL_LIGHT : MUTED,
              fontFamily: "IBM Plex Mono",
              fontSize: 17 * scale,
              letterSpacing: 1.2 * scale,
            }}
          >
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function Landscape() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 64,
        background: BG,
        color: INK,
        fontFamily: "IBM Plex Sans",
      }}
    >
      <Grid />
      <Glow size={900} />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Seal size={52} />
        <div style={{ display: "flex", fontSize: 27, fontWeight: 600, letterSpacing: -0.4 }}>
          Agent Evidence Recorder
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          marginTop: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 62,
            lineHeight: 1.08,
            letterSpacing: -1.8,
            maxWidth: 940,
          }}
        >
          Prove what your AI agents did — without storing what they saw.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <ChainStrip />
        <div
          style={{
            display: "flex",
            fontFamily: "IBM Plex Mono",
            fontSize: 18,
            color: GOLD,
            letterSpacing: 0.6,
          }}
        >
          aer.ktlsr.com
        </div>
      </div>
    </div>
  );
}

function Square() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 96,
        background: BG,
        color: INK,
        fontFamily: "IBM Plex Sans",
        justifyContent: "space-between",
      }}
    >
      <Grid />
      <Glow size={1000} />
      <Seal size={150} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 82,
            lineHeight: 1.06,
            letterSpacing: -2.2,
            maxWidth: 900,
          }}
        >
          Agent Evidence Recorder
        </div>
        <div style={{ display: "flex", fontSize: 38, color: MUTED, marginTop: 28 }}>
          Audit-ready evidence layer for AI agent runs.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        <ChainStrip />
        <div
          style={{
            display: "flex",
            fontFamily: "IBM Plex Mono",
            fontSize: 24,
            color: GOLD,
            letterSpacing: 0.8,
          }}
        >
          aer.ktlsr.com
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: BG,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Google Ads crops square logos to a circle, so keep the mark inside ~70%. */}
      <Seal size={780} />
    </div>
  );
}

const TARGETS = [
  { file: join(OUT_DIR, "og.png"), width: 1200, height: 628, node: <Landscape /> },
  { file: join(OUT_DIR, "square.png"), width: 1200, height: 1200, node: <Square /> },
  { file: join(OUT_DIR, "logo.png"), width: 1200, height: 1200, node: <Logo /> },
  { file: join(OUT_DIR, "icon-192.png"), width: 192, height: 192, node: <Logo /> },
  { file: join(OUT_DIR, "icon-512.png"), width: 512, height: 512, node: <Logo /> },
  { file: join(WEB_ROOT, "app", "apple-icon.png"), width: 180, height: 180, node: <Logo /> },
];

async function main() {
  const fonts = await loadFonts();
  mkdirSync(OUT_DIR, { recursive: true });

  for (const { file, width, height, node } of TARGETS) {
    const res = new ImageResponse(node, { width, height, ...(fonts.length ? { fonts } : {}) });
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, bytes);
    console.log(`✓ ${file.replace(WEB_ROOT, "").replace(/\\/g, "/")}  ${width}x${height}  ${(bytes.length / 1024).toFixed(0)} kB`);
  }
}

main();
