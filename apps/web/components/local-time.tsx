"use client";

import { useEffect, useState } from "react";

/** Stable UTC fallback — identical on the server and the first client render, so there is no
 *  hydration mismatch. After mount we swap to the viewer's local timezone. */
function utcCompact(iso: string): string {
  return `${iso.slice(0, 19).replace("T", " ")}Z`;
}

/**
 * Render a UTC ISO timestamp in the VIEWER's local timezone + locale (resolved in the browser).
 * The audit-canonical UTC value stays in the `title` (hover) and `dateTime` attribute, so precision
 * is never lost. Export packets (JSON/PDF) keep UTC — only the dashboard display is localized.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState(() => utcCompact(iso));
  const [title, setTitle] = useState(() => `UTC ${utcCompact(iso)}`);

  useEffect(() => {
    const d = new Date(iso);
    setText(
      d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTitle(`UTC ${utcCompact(iso)}${tz ? ` · shown in ${tz}` : ""}`);
  }, [iso]);

  return (
    <time dateTime={iso} title={title} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
