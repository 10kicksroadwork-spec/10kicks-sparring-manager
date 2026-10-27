import type { sheets_v4 } from "googleapis";
import type { AuditEvent, ReadResult, SparringRepository } from "@/lib/repository/types";
import { getSheets, requireSpreadsheetId, userEnteredCells, withSheetsRetry } from "./client";
import {
  TAB_HEADERS,
  TAB_NAMES,
  assignmentToRow,
  athleteToRow,
  attendanceToRow,
  auditToRow,
  overrideToRow,
  parseAssignmentRow,
  parseAthleteRow,
  parseAttendanceRow,
  parseAuditRow,
  parseOverrideRow,
  parseRestrictionRow,
  parseSessionRow,
  restrictionToRow,
  sessionToRow,
  type TabName,
} from "./rows";

type Grid = { sheetId: number; values: unknown[][] };

async function loadGrids(): Promise<Map<TabName, Grid>> {
  const sheets = getSheets();
  const spreadsheetId = requireSpreadsheetId();
  const meta = await withSheetsRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" }),
  );
  const ids = new Map<string, number>();
  for (const sheet of meta.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId !== undefined && sheetId !== null) ids.set(title, sheetId);
  }
  const ranges = TAB_NAMES.map((name) => `${name}!A:${columnLetter(TAB_HEADERS[name].length)}`);
  const values = await withSheetsRetry(() => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }));
  const grids = new Map<TabName, Grid>();
  TAB_NAMES.forEach((name, index) => {
    const sheetId = ids.get(name);
    if (sheetId === undefined) throw new Error(`Spreadsheet is missing the ${name} tab. Run sheets:init.`);
    grids.set(name, { sheetId, values: (values.data.valueRanges?.[index]?.values ?? []) as unknown[][] });
  });
  return grids;
}

function columnLetter(count: number): string {
  let n = count;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function collect<T extends Record<string, unknown>>(
  rows: unknown[][],
  parse: (row: unknown[]) => { skip: true } | { error: string } | T,
): ReadResult<T[keyof T]> {
  const parsed: Array<T[keyof T]> = [];
  const corrupt: string[] = [];
  for (const row of rows.slice(1)) {
    const result = parse(row);
    if ("skip" in result) continue;
    if ("error" in result && typeof result.error === "string") {
      corrupt.push(result.error);
      continue;
    }
    parsed.push(Object.values(result)[0] as T[keyof T]);
  }
  return { rows: parsed, corrupt };
}

function findRow(values: unknown[][], id: string): number {
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index]?.[0] ?? "") === id) return index;
  }
  return -1;
}

export function createSheetsRepository(): SparringRepository {
  return {
    kind: "sheets",
    async readAthletes() {
      const grids = await loadGrids();
      return collect(grids.get("Athletes")?.values ?? [], parseAthleteRow);
    },
    async readSessions() {
      const grids = await loadGrids();
      return collect(grids.get("Sessions")?.values ?? [], parseSessionRow);
    },
    async readAttendance(sessionId) {
      const grids = await loadGrids();
      const all = collect(grids.get("Attendance")?.values ?? [], parseAttendanceRow);
      return { rows: sessionId ? all.rows.filter((row) => row.sessionId === sessionId) : all.rows, corrupt: all.corrupt };
    },
    async readAssignments(sessionId) {
      const grids = await loadGrids();
      const all = collect(grids.get("Assignments")?.values ?? [], parseAssignmentRow);
      return { rows: sessionId ? all.rows.filter((row) => row.sessionId === sessionId) : all.rows, corrupt: all.corrupt };
    },
    async readRestrictions() {
      const grids = await loadGrids();
      return collect(grids.get("Restrictions")?.values ?? [], parseRestrictionRow);
    },
    async readOverrides(sessionId) {
      const grids = await loadGrids();
      const all = collect(grids.get("Overrides")?.values ?? [], parseOverrideRow);
      return { rows: sessionId ? all.rows.filter((row) => row.sessionId === sessionId) : all.rows, corrupt: all.corrupt };
    },
    async readAudit(sessionId) {
      const grids = await loadGrids();
      const all = collect(grids.get("AuditLog")?.values ?? [], parseAuditRow);
      return { rows: sessionId ? all.rows.filter((row) => row.sessionId === sessionId) : all.rows, corrupt: all.corrupt };
    },
    async commit(batch) {
      const grids = await loadGrids();
      const requests: sheets_v4.Schema$Request[] = [];
      const cursors = new Map<TabName, number>();
      const nextRow = (tab: TabName) => {
        const current = cursors.get(tab) ?? Math.max(grids.get(tab)?.values.length ?? 1, 1);
        cursors.set(tab, current + 1);
        return current;
      };
      const write = (tab: TabName, rowIndex: number, values: (string | number | boolean)[]) => {
        const sheetId = grids.get(tab)?.sheetId;
        if (sheetId === undefined) throw new Error(`Missing ${tab}`);
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: values.length,
            },
            rows: [{ values: userEnteredCells(values) }],
            fields: "userEnteredValue",
          },
        });
      };
      const put = (tab: TabName, id: string, values: (string | number | boolean)[]) => {
        const existing = findRow(grids.get(tab)?.values ?? [], id);
        write(tab, existing === -1 ? nextRow(tab) : existing, values);
      };
      for (const athlete of batch.athletes ?? []) put("Athletes", athlete.athleteId, athleteToRow(athlete));
      if (batch.session) put("Sessions", batch.session.sessionId, sessionToRow(batch.session));
      for (const row of batch.attendance ?? []) put("Attendance", row.attendanceId, attendanceToRow(row));
      for (const row of batch.assignmentInserts ?? []) write("Assignments", nextRow("Assignments"), assignmentToRow(row));
      for (const row of batch.assignmentUpdates ?? []) {
        const values = grids.get("Assignments")?.values ?? [];
        let index = -1;
        for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
          if (String(values[rowIndex]?.[0] ?? "") === row.assignmentId && String(values[rowIndex]?.[2] ?? "") === row.generationId) {
            index = rowIndex;
            break;
          }
        }
        write("Assignments", index === -1 ? nextRow("Assignments") : index, assignmentToRow(row));
      }
      if (batch.restriction) put("Restrictions", batch.restriction.restrictionId, restrictionToRow(batch.restriction));
      if (batch.override) put("Overrides", batch.override.overrideId, overrideToRow(batch.override));
      write("AuditLog", nextRow("AuditLog"), auditToRow(batch.audit));
      const sheets = getSheets();
      await withSheetsRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: requireSpreadsheetId(),
          requestBody: { requests },
        }),
      );
    },
    async deleteSessionCascade() {
      const error = new Error("Session delete is not supported on the Sheets store");
      error.name = "STORE_FAILED";
      throw error;
    },
  };
}

export type { AuditEvent };
