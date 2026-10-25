import { mkdir, writeFile } from "node:fs/promises";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main(): Promise<void> {
  const { sheetsConfigured, getSheets, requireSpreadsheetId } = await import("../lib/sheets/client");
  if (!sheetsConfigured()) {
    console.error("backup:sheet skipped. Google Sheets is not configured. No backup file was written.");
    process.exitCode = 1;
    return;
  }
  const { TAB_NAMES } = await import("../lib/sheets/rows");
  const sheets = getSheets();
  const spreadsheetId = requireSpreadsheetId();
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [...TAB_NAMES] });
  const tabs = TAB_NAMES.map((name, index) => ({
    name,
    rows: response.data.valueRanges?.[index]?.values ?? [],
  }));
  const dir = process.env.BACKUP_DIR || "/tmp/10kicks-sparring-backups";
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${dir}/sparring-backup-${stamp}.json`;
  await writeFile(path, JSON.stringify({ exportedAt: new Date().toISOString(), tabs }, null, 2), { mode: 0o600 });
  const rowCounts = Object.fromEntries(tabs.map((tab) => [tab.name, Math.max(0, tab.rows.length - 1)]));
  console.log(JSON.stringify({ path, rowCounts }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "backup:sheet failed";
  console.error(message);
  process.exitCode = 1;
});
