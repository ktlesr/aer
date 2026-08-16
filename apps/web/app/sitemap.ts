import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// ponytail: the marketing page is the only public URL. Add entries here as
// public pages (docs, changelog, pricing) appear — no generator needed for one route.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, changeFrequency: "monthly", priority: 1 }];
}
