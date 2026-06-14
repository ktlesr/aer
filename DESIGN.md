---
name: Agent Evidence Recorder
description: Audit-ready evidence layer for AI agent runs — a forensic ledger you can trust.
colors:
  # Identity accent (theme-independent role; values differ per theme)
  seal-console: "oklch(0.77 0.13 192)"        # petrol-teal, dark theme
  seal-paper: "oklch(0.52 0.085 196)"         # deep petrol-teal, light theme
  seal-strong-console: "oklch(0.68 0.13 195)"
  gold: "oklch(0.82 0.1 86)"                  # secondary accent (human-approval / signature)
  # Security Console (dark — default)
  console-bg: "oklch(0.16 0.015 252)"
  console-surface: "oklch(0.196 0.016 252)"
  console-ink: "oklch(0.93 0.006 220)"
  console-ink-muted: "oklch(0.66 0.015 240)"
  console-border: "oklch(1 0 0 / 9%)"
  # Archive Paper (light)
  paper-bg: "oklch(0.985 0.005 95)"
  paper-surface: "oklch(1 0 0)"
  paper-ink: "oklch(0.21 0.012 262)"
  paper-ink-muted: "oklch(0.49 0.012 262)"
  paper-border: "oklch(0.9 0.006 250)"
  # Semantic
  danger: "oklch(0.68 0.19 25)"
  risk-medium: "oklch(0.77 0.16 75)"          # amber
  risk-high: "oklch(0.7 0.18 50)"             # orange
  status-running: "oklch(0.68 0.15 240)"      # sky
  status-completed: "oklch(0.7 0.15 155)"     # emerald
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "ss01, cv05"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.66rem"
    fontWeight: 500
    letterSpacing: "0.2em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.7rem"
  pill: "9999px"
spacing:
  xs: "0.375rem"
  sm: "0.625rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.console-ink}"
    textColor: "{colors.console-bg}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  button-outline:
    backgroundColor: "{colors.console-bg}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.lg}"
    height: "2rem"
  button-destructive:
    backgroundColor: "oklch(0.68 0.19 25 / 0.2)"
    textColor: "{colors.danger}"
    rounded: "{rounded.lg}"
    height: "2rem"
  badge:
    rounded: "{rounded.pill}"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
  card:
    backgroundColor: "{colors.console-surface}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  hash-seal:
    backgroundColor: "{colors.console-surface}"
    textColor: "{colors.seal-console}"
    rounded: "{rounded.lg}"
    padding: "1rem"
---

# Design System: Agent Evidence Recorder

## 1. Overview

**Creative North Star: "The Forensic Ledger, read in the Security Console."**

AER looks like *evidence*, not a product demo. Picture a compliance reviewer at a dark
operations console under low light, scrolling a tamper-evident chain of everything an agent
did — each entry sealed, hashed, and redacted before it ever reached the screen. The default
surface is the **Security Console** (a deep blue-graphite dark theme with a faint blueprint
grid and a single petrol-teal "seal" glow). Its counterpart is **Archive Paper** (a near-white
light theme), the same record printed for the file. Both are the same ledger in two lights.

The system earns trust through **restraint**. One saturated accent — the petrol-teal seal —
appears only where evidence integrity is at stake (redaction marks, the hash seal, focus,
current selection). Everything else is neutral graphite or paper. Type does the heavy lifting:
a Fraunces serif for headings gives the record gravity and an archival, documentary voice;
IBM Plex Sans carries body; IBM Plex Mono carries every hash, timestamp, sequence number, and
label, so machine-verifiable facts always *look* machine-verifiable. Motion is near-silent:
a single staggered rise as a timeline loads, and 150–250 ms state transitions — nothing
choreographed, because a reviewer under scrutiny does not want to watch the page perform.

This system explicitly **rejects** the visual language of the tools it is not. It is **not** a
generic AI-observability dashboard (no gauge walls, sparklines, or token-cost charts — AER is
evidence, not telemetry). It is **not** playful consumer SaaS (no mascots, gradient blobs,
emoji, or bouncy motion). It is **not** heavy enterprise/legacy chrome (no gray dropdown soup
or 2010-era density). It is **not** crypto "immutable ledger" hype (no neon, no hexagons, no
hype copy). And it avoids the decorative AI defaults — gradient text, default glassmorphism,
accent-color soup, ornamental animation, eyebrow-on-every-section scaffolding.

**Key Characteristics:**
- Dark-by-default "Security Console"; light "Archive Paper" as the printed counterpart.
- One identity accent (petrol-teal **seal**), used only for evidence-integrity signals.
- Serif headings (Fraunces) + sans body (Plex Sans) + mono for all facts (Plex Mono).
- Tamper-evidence is first-class UI: hashes, timestamps, and the chronological spine are visible.
- Redacted-by-default; restraint and precision over decoration and density.

## 2. Colors

A graphite-and-paper neutral field with a single petrol-teal accent; semantic hues appear only
as small risk/status signals, never as surface decoration.

### Primary
- **Evidence Seal — Console** (`oklch(0.77 0.13 192)`): The identity accent in the dark theme.
  Reserved for evidence integrity: redaction markers, the hash seal, focus rings, current
  selection, and primary links. Never decorative.
- **Evidence Seal — Paper** (`oklch(0.52 0.085 196)`): The same role in the light theme, darkened
  to hold 4.5:1 against paper. **Seal-Strong** (`oklch(0.68 0.13 195)` console) is the pressed/
  hover state.

### Secondary
- **Approval Gold** (`oklch(0.82 0.1 86)` console / `oklch(0.74 0.1 85)` paper): The signature/
  human-approval accent. Used sparingly to mark the irreversible-step approval and seal flourish —
  the one warm note in an otherwise cool field.

### Neutral
- **Console Field** (`oklch(0.16 0.015 252)`): The dark app background — blue-graphite, not black.
- **Console Surface** (`oklch(0.196 0.016 252)`): Cards, panels, popovers in dark.
- **Console Ink** (`oklch(0.93 0.006 220)`): Primary text in dark. **Console Ink Muted**
  (`oklch(0.66 0.015 240)`): timestamps, secondary labels — verified ≥4.5:1 on the field.
- **Paper Field / Surface** (`oklch(0.985 0.005 95)` / `oklch(1 0 0)`): Light background and cards.
- **Paper Ink / Ink Muted** (`oklch(0.21 0.012 262)` / `oklch(0.49 0.012 262)`): Light text.
- **Borders** (`oklch(1 0 0 / 9%)` console / `oklch(0.9 0.006 250)` paper): Hairline dividers and
  the timeline spine — felt, not seen.

### Semantic (small signals only)
- **Danger** (`oklch(0.68 0.19 25)`): Errors and failed runs. Surfaced as a tinted chip
  (`danger/10–20%`), never a full-saturation fill.
- **Risk / Status dots**: low = slate, medium = amber, high = orange, critical = red; running =
  sky, completed = emerald, needs-approval = amber. Always paired with a text label — color is
  never the only carrier of meaning.

### Named Rules
**The Seal-Only Rule.** The petrol-teal seal is reserved for evidence integrity — redaction,
hashing, focus, selection. If teal appears as background fill or decoration, it is wrong.
**The Cool-Field Rule.** Surfaces are cool graphite or neutral paper. Warmth enters only through
Approval Gold and the Fraunces serif — never through a tinted "cream" background.

## 3. Typography

**Display Font:** Fraunces (with Georgia, serif fallback) — also serves `--font-serif` / `--font-heading`.
**Body Font:** IBM Plex Sans (with system-ui, sans-serif).
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace).

**Character:** A deliberate contrast pairing — Fraunces' archival, slightly literary serif gives
the record gravity and documentary authority; Plex Sans keeps the working UI quiet and legible;
Plex Mono makes every verifiable fact look verifiable. Body runs with `ss01, cv05` enabled and
tabular numerics on mono and data.

### Hierarchy
- **Display** (Fraunces, 500, ~1.5rem, lh 1.2): Page and section titles, card titles via
  `font-heading`. Fixed rem scale — no fluid clamps in product UI.
- **Headline** (Fraunces, 500, ~1rem, lh 1.35): Card titles, panel headings.
- **Body** (Plex Sans, 400, 0.875rem, lh 1.55): Default UI and prose; cap prose at 65–75ch.
- **Data** (Plex Mono, 400, 0.75rem, lh 1.6, tabular-nums): Hashes, timestamps, JSON payloads,
  costs, sequence numbers. Dense lines may run past 75ch.
- **Label / Eyebrow** (Plex Mono, 500, 0.66rem, uppercase, tracking 0.2em): The `.eyebrow`
  utility — event-type kickers, section labels. Mono + tracking signals "metadata", not heading.

### Named Rules
**The Mono-for-Facts Rule.** Anything a reviewer might verify — hash, timestamp, sequence,
cost, id — is set in IBM Plex Mono with tabular numerics. Facts are never set in the serif.
**The Serif-for-Gravity Rule.** Fraunces appears only at heading/title weight. Never in labels,
buttons, data, or running body — display type in UI labels is forbidden.

## 4. Elevation

Mostly flat, with tonal layering carrying depth: the Console Field sits behind Console Surface
cards, separated by a hairline border and a single soft shadow on hover. Dark cards use a 1px
ring (`ring-foreground/10`) instead of heavy borders. Atmosphere — a fixed seal-tinted radial
wash, a faint blueprint grid (dark only), and a ~4% soft-light grain — sits at `z-index: 0`
behind all content to give the console air without competing with it.

### Shadow Vocabulary
- **Soft** (`--shadow-soft`): dark = `0 1px 2px -1px oklch(0 0 0 / 55%), 0 20px 44px -26px oklch(0 0 0 / 75%)`;
  light = `0 1px 2px -1px …/14%, 0 14px 32px -22px …/32%`. The only elevation token. Applied on
  card/row hover, popovers, and the hash seal — a quiet lift, never a drop-shadow slab.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest, separated by hairline borders and tone.
Shadow appears only as a *response to state* (hover, focus, open). If a card has a resting
drop shadow, it is too heavy — remove it.

## 5. Components

### Buttons
- **Shape:** Gently rounded (`rounded-lg`, 0.5rem); compact default height 2rem (`h-8`), with
  xs/sm/lg and icon variants on a fixed scale.
- **Primary:** Console Ink fill on the field's contrast (`bg-primary text-primary-foreground`),
  hover to `primary/80`. Quiet and confident, not loud.
- **Outline / Secondary / Ghost:** Hairline or tonal; hover lifts to `muted`. Ghost is
  background-only-on-hover for toolbar density.
- **Destructive:** Tinted, never filled — `destructive/10` bg, `destructive` text, hover `/20`.
- **States:** `focus-visible` shows a 3px seal ring (`ring-ring/50`) + border; `active` nudges
  `translateY(1px)`; disabled drops to 50% opacity. All present on every variant.

### Badges & Status Pills
- **Style:** Full-pill (`rounded-4xl`), 1.25rem tall, `text-xs font-medium`. Variants: default,
  secondary, outline, ghost, destructive (tinted).
- **Risk / Status badge (signature):** A bordered pill on `bg-card` with a 1.5px colored **dot**
  plus a mono uppercase tracked label. The dot encodes severity (slate→amber→orange→red); the
  label guarantees meaning survives without color.

### Cards / Containers
- **Corner Style:** `rounded-xl` (0.7rem); the `.surface` utility uses `rounded-lg`.
- **Background:** Console Surface (dark) / pure white (light).
- **Border:** 1px ring `ring-foreground/10` (cards) or hairline `border` (`.surface`).
- **Shadow Strategy:** Flat at rest; `--shadow-soft` on hover only (see Elevation).
- **Internal Padding:** `--card-spacing` 1rem (sm: 0.75rem). Footers sit on `muted/50` with a top border.

### Inputs / Fields
- **Style:** Hairline border on field/surface, `rounded-lg`. Mono for hash/id inputs.
- **Focus:** 3px seal ring + border shift (`ring-ring/50`, `border-ring`). No glow beyond the ring.

### Navigation
- App-shell layout: a top/side frame around the runs list and run detail. Mono labels for
  metadata, serif for titles, seal for the active item. Standard, familiar affordances only.

### Evidence Timeline (signature)
The core surface. A vertical `ol` with a continuous hairline **spine** (a top/bottom-faded
gradient) and a node per event, both anchored at the same x. Each node is a ringed dot; events
with redactions get a **seal-colored node** with a 3px seal halo. Each row is a flat card
(`border-border/70`) that lifts on hover. Rows carry: a mono `NN · EVENT_TYPE` eyebrow, an
optional RiskBadge, a seal-tinted `ShieldAlert · N redacted` chip, a serif-weight title, a mono
metadata line (timestamp · cost · in/out summary), and a collapsible **redacted** payload viewer
(`<pre>` on `muted/40`). Entrance is a 55ms-staggered `animate-rise`.

### Hash Seal (signature)
A tamper-evidence stamp. A `.surface` card with a seal-tinted border and a faint radial
seal-wash, a `ShieldCheck` + mono `Tamper-evident · sha256` eyebrow in seal color, the full
digest broken in mono, and two concentric seal-ring "wax stamp" circles bleeding off the
top-right corner. The single most expressive component — and still restrained.

## 6. Do's and Don'ts

### Do:
- **Do** keep dark "Security Console" as the default theme; offer light "Archive Paper" as the
  printed-record counterpart, not a different design.
- **Do** reserve the petrol-teal **seal** for evidence integrity only — redaction, hashing,
  focus, current selection. Its rarity is the point (The Seal-Only Rule).
- **Do** set every verifiable fact (hash, timestamp, sequence, cost, id) in IBM Plex Mono with
  tabular numerics; set every title in Fraunces.
- **Do** pair color with an icon or label on risk/status/redaction signals — never color alone.
- **Do** keep surfaces flat at rest; reveal `--shadow-soft` only on hover/focus/open.
- **Do** default to the redacted view; gate any raw value behind an explicit, deliberate warning.
- **Do** keep motion to one staggered timeline rise and 150–250 ms state transitions, with a
  `prefers-reduced-motion` fallback.

### Don't:
- **Don't** build a generic AI-observability dashboard — no gauge walls, sparklines, or
  token-cost hero charts. AER is evidence, not telemetry.
- **Don't** drift toward playful consumer SaaS: no mascots, gradient blobs, emoji, or bouncy/
  elastic motion.
- **Don't** ship heavy enterprise/legacy chrome — gray dropdown soup, 2010-era density.
- **Don't** borrow crypto "immutable ledger" hype: no neon glow, hexagons, or hype copy.
- **Don't** use gradient text (`background-clip: text`), default glassmorphism, accent-color
  soup, or an eyebrow/`01·02·03` marker on every section.
- **Don't** use a colored `border-left`/`border-right` stripe >1px as an accent on cards, rows,
  or callouts. Use full hairline borders, tonal tints, or the seal node instead.
- **Don't** fill anything with full-saturation seal or danger; use tinted chips (`/8–20%`).
- **Don't** set Fraunces in labels, buttons, data, or running body. Serif is for gravity, not chrome.
