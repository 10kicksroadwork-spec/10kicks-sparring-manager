import { createMemoryRepository } from "./memory";
import type { SparringRepository } from "./types";
import { sheetsConfigured } from "@/lib/sheets/client";
import { createSheetsRepository } from "@/lib/sheets/repository";

export class StoreUnavailable extends Error {
  constructor() {
    super("The gym spreadsheet is not configured");
    this.name = "STORE_UNAVAILABLE";
  }
}

export function getRepository(): SparringRepository {
  if (process.env.SPARRING_STORE === "memory") {
    if (process.env.NODE_ENV === "production") {
      throw new StoreUnavailable();
    }
    return createMemoryRepository();
  }
  if (sheetsConfigured()) return createSheetsRepository();
  throw new StoreUnavailable();
}
