import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No custom bundler config needed.
  // Help center markdown is inlined at build time via scripts/generate-manual.mjs
  // (runs in npm "prebuild") — the generated TS file is then a normal import.
};

export default nextConfig;
