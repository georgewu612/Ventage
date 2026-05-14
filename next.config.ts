import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the manual markdown files with the help-center serverless
  // functions. Without this, fs.readFileSync(.../src/content/manual)
  // works locally but the files are tree-shaken out of the Vercel build,
  // making /dashboard/help return an empty index.
  outputFileTracingIncludes: {
    "/dashboard/help": ["./src/content/manual/**/*"],
    "/dashboard/help/[slug]": ["./src/content/manual/**/*"],
  },
};

export default nextConfig;
