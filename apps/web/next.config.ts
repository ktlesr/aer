import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo root: silences the multi-lockfile workspace-root inference warning.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
