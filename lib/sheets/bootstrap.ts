import type { sheets_v4 } from "googleapis";
import { getSheets, requireSpreadsheetId, userEnteredCells, withSheetsRetry } from "./client";
import { TAB_HEADERS, TAB_NAMES, type TabName } from "./rows";

const VALIDATION: Partial<Record<TabName, { column: number; values: string[] }[]>> = {
  Athletes: [{ column: 5, values: ["FIGHTER", "VOLUNTEER", "BOTH"] }],
  Sessions: [{ column: 3, values: ["DRAFT", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED"] }],
  Attendance: [
    { column: 3, values: ["FIGHTER", "VOLUNTEER"] },
    { column: 5, values: ["AVAILABLE", "DEPARTED", "REMOVED"] },
  ],
  Assignments: [
    { column: 4, values: ["MAIN_RING", "FLOOR_1", "FLOOR_2"] },
    { column: 7, values: ["PLANNED", "IN_PROGRESS", "COMPLETED", "INTERRUPTED"] },
  ],
};

/**
 * Create the seven source-of-truth tabs if needed.
 * Reruns keep existing data rows. Headers are written only when row 1 is empty or already matches.
 */
export async function bootstrapSpreadsheet(): Promise<{ created: string[]; verified: string[] }> {
  const sheets = getSheets();
  const spreadsheetId = requireSpreadsheetId();
  const meta = await withSheetsRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" }),
  );
  const existing = new Map<string, number>();
  for (const sheet of meta.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId !== undefined && sheetId !== null) existing.set(title, sheetId);
  }
  const requests: sheets_v4.Schema$Request[] = [];
  const created: string[] = [];
  for (const name of TAB_NAMES) {
    if (!existing.has(name)) {
      created.push(name);
      requests.push({ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } });
    }
  }
  if (requests.length) {
    await withSheetsRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }));
  }
  const refreshed = await withSheetsRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" }),
  );
  const ids = new Map<string, number>();
  for (const sheet of refreshed.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId !== undefined && sheetId !== null) ids.set(title, sheetId);
  }
  const headerRanges = TAB_NAMES.map((name) => `${name}!1:1`);
  const headerValues = await withSheetsRetry(() => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: headerRanges }));
  const formatRequests: sheets_v4.Schema$Request[] = [];
  for (const name of TAB_NAMES) {
    const sheetId = ids.get(name);
    if (sheetId === undefined) throw new Error(`Could not create ${name}`);
    const index = TAB_NAMES.indexOf(name);
    const current = (headerValues.data.valueRanges?.[index]?.values?.[0] ?? []).map((cell) => String(cell));
    const expected = [...TAB_HEADERS[name]];
    const headerEmpty = current.every((cell) => cell.trim() === "");
    const headerMatches = expected.every((header, cell) => current[cell] === header);
    if (!headerEmpty && !headerMatches) {
      throw new Error(`${name} headers do not match the app schema. Refusing to overwrite existing headers.`);
    }
    if (headerEmpty) {
      formatRequests.push({
        updateCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: expected.length },
          rows: [{ values: userEnteredCells(expected) }],
          fields: "userEnteredValue",
        },
      });
    }
    formatRequests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    });
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: expected.length },
        properties: { pixelSize: 160 },
        fields: "pixelSize",
      },
    });
    if (created.includes(name) || headerEmpty) {
      formatRequests.push({
        addProtectedRange: {
          protectedRange: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: expected.length },
            description: "Header row. The web app owns live-session writes.",
            warningOnly: true,
          },
        },
      });
    }
    for (const rule of VALIDATION[name] ?? []) {
      formatRequests.push({
        setDataValidation: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: rule.column, endColumnIndex: rule.column + 1 },
          rule: {
            condition: { type: "ONE_OF_LIST", values: rule.values.map((value) => ({ userEnteredValue: value })) },
            showCustomUi: true,
            strict: false,
          },
        },
      });
    }
  }
  await withSheetsRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatRequests } }));
  return { created, verified: [...TAB_NAMES] };
}

/** Reversible marker outside the schema columns. Does not touch athlete rows. */
export async function smokeTestSheets(): Promise<{ ok: true }> {
  const sheets = getSheets();
  const spreadsheetId = requireSpreadsheetId();
  const marker = `ok-${Date.now()}`;
  await withSheetsRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Sessions!ZZ1",
      valueInputOption: "RAW",
      requestBody: { values: [[marker]] },
    }),
  );
  const read = await withSheetsRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range: "Sessions!ZZ1" }));
  const seen = String(read.data.values?.[0]?.[0] ?? "");
  await withSheetsRetry(() =>
    sheets.spreadsheets.values.clear({ spreadsheetId, range: "Sessions!ZZ1" }),
  );
  if (seen !== marker) throw new Error("Sheets smoke test could not read back its marker");
  return { ok: true };
}
