import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main(): Promise<void> {
  const { sheetsConfigured } = await import("../lib/sheets/client");
  if (!sheetsConfigured()) {
    console.error("sheets:validate skipped. Google Sheets is not configured, so nothing was read or written.");
    process.exitCode = 1;
    return;
  }
  const { smokeTestSheets } = await import("../lib/sheets/bootstrap");
  await smokeTestSheets();
  console.log(JSON.stringify({ ok: true, check: "Sessions!ZZ1 write, read, and clear" }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "sheets:validate failed";
  console.error(message);
  process.exitCode = 1;
});
