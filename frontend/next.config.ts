import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (only the deps actually used, no full
  // node_modules) — the standard minimal-image pattern for Dockerizing
  // Next.js; see Dockerfile's runtime stage, which copies exactly this.
  output: "standalone",
};

export default nextConfig;
