import { existsSync, readFileSync } from "node:fs";

/** Load .env.local without printing values. Existing process env wins. */
export function loadLocalEnv(): void {
  for (const path of [".env.local", ".env"]) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Z0-9_]+$/.test(key) || process.env[key] !== undefined) continue;
      let raw = trimmed.slice(eq + 1).trim();
      const quote = raw[0];
      if (quote === '"' || quote === "'") {
        let body = raw.slice(1);
        while (!body.endsWith(quote) && index + 1 < lines.length) {
          index += 1;
          body += `\n${lines[index] ?? ""}`;
        }
        if (body.endsWith(quote)) body = body.slice(0, -1);
        raw = body.replace(/\\n/g, "\n");
      }
      process.env[key] = raw;
    }
  }
}
