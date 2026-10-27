import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

// Large source files are uploaded in checked parts. Restore them before compile.
const partsRoot = join(process.cwd(), "deploy-parts");
if (existsSync(partsRoot)) {
  for (const metaName of readdirSync(partsRoot).filter((name) => name.endsWith(".json"))) {
    const spec = JSON.parse(readFileSync(join(partsRoot, metaName), "utf8")) as {
      file: string;
      sha: string;
      size: number;
      parts: string[];
    };
    const body = Buffer.concat(spec.parts.map((part) => readFileSync(join(partsRoot, part))));
    const sha = createHash("sha1").update(body).digest("hex");
    if (sha !== spec.sha || body.length !== spec.size) throw new Error(`Could not restore ${spec.file}`);
    const target = join(process.cwd(), spec.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
}

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
