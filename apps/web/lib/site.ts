import type { Metadata } from "next";

/** Canonical public origin of this deployment. Used for metadata, sitemap and SDK snippets. */
export const SITE_URL = process.env.AUTH_URL ?? "https://aer.ktlsr.com";

export const SITE_NAME = "Agent Evidence Recorder";
export const SITE_TAGLINE = "Audit-ready evidence layer for AI agent runs";
export const SITE_DESCRIPTION =
  "Turn every AI agent action — model calls, tool calls, approvals, redactions — into a chronological, hash-anchored evidence packet. Provable to an auditor, with no raw sensitive data stored.";

/**
 * The root layout opts the site into indexing for the public marketing page.
 * Every authenticated route spreads this to opt back out — robots.txt keeps
 * crawlers away, this keeps the URLs out of the index if one gets there anyway.
 */
export const PRIVATE_PAGE: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
