import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Authenticated gym data must not be prerendered into a shared cache.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
