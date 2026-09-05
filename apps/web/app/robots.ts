import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Everything behind auth (and the API) is tenant data — never crawlable.
      // /login and /signup are deliberately NOT here: a credential form a site hides from
      // crawlers is a phishing signal. They hold no tenant data, so let them be seen.
      disallow: ["/api/", "/runs", "/keys"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
