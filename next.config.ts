import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Treat .md files as static text imports so the help center can bundle
  // manual content directly into the JS bundle. This bypasses Vercel's
  // runtime file-tracing issue where fs.readFileSync on src/content/manual
  // returns nothing because the files weren't traced into the function.
  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      type: "asset/source",
    });
    return config;
  },
  // Belt + suspenders: also tell Next.js file tracing to include manual
  // files, in case anything outside the JS bundle ever needs them.
  outputFileTracingIncludes: {
    "/dashboard/help": ["./src/content/manual/**/*"],
    "/dashboard/help/[slug]": ["./src/content/manual/**/*"],
  },
};

export default nextConfig;
