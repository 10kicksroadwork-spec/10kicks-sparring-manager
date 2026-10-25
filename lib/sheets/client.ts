import { google, type sheets_v4 } from "googleapis";

export function sheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function requireSpreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID?.trim();
  if (!id) throw new Error("Google Sheets is not configured");
  return id;
}

export function getSheets(): sheets_v4.Sheets {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Google Sheets is not configured");
  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
  } catch {
    throw new Error("Google service account configuration could not be read");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google service account configuration is incomplete");
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function withSheetsRetry<T>(fn: () => Promise<T>): Promise<T> {
  let delay = 250;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const status = statusOf(error);
      lastStatus = status;
      if (status !== 429 && status !== 500 && status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 150)));
      delay *= 2;
    }
  }
  if (lastStatus === 429) {
    const busy = new Error("Google Sheets is busy. Wait a moment and try again.");
    busy.name = "SHEETS_BUSY";
    throw busy;
  }
  const failed = new Error("Google Sheets request failed");
  failed.name = "SHEETS_FAILED";
  throw failed;
}

function statusOf(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const candidate = error as { code?: number; response?: { status?: number } };
  if (typeof candidate.code === "number") return candidate.code;
  return candidate.response?.status ?? 0;
}

export function userEnteredCells(values: (string | number | boolean)[]) {
  return values.map((value) => {
    if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
    if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
    return { userEnteredValue: { stringValue: value } };
  });
}
