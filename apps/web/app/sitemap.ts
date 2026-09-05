import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// ponytail: hand-listed — every public URL fits on one screen. Add entries here as public
// pages (docs, changelog, pricing) appear; no generator needed for five routes.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/signup`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
