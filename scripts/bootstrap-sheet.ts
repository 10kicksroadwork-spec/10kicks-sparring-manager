import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main(): Promise<void> {
  const { sheetsConfigured } = await import("../lib/sheets/client");
  if (!sheetsConfigured()) {
    console.error("sheets:init skipped. Google Sheets is not configured, so no tabs were written.");
    process.exitCode = 1;
    return;
  }
  const { bootstrapSpreadsheet } = await import("../lib/sheets/bootstrap");
  const result = await bootstrapSpreadsheet();
  console.log(JSON.stringify({ created: result.created, verified: result.verified }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "sheets:init failed";
  console.error(message);
  process.exitCode = 1;
});
