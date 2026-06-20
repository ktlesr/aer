import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework. Security headers + CSP are set in middleware.ts.
  poweredByHeader: false,
  // Consume the dependency-free evidence-chain package from TS source (no prebuilt dist).
  transpilePackages: ["@ktlsr/evidence-chain"],
  // Monorepo root: silences the multi-lockfile workspace-root inference warning.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
