import { supabaseConfigured } from "@/lib/env";
import { createSupabaseRepository } from "@/lib/supabase/repository";
import { createMemoryRepository } from "./memory";
import type { SparringRepository } from "./types";

export class StoreUnavailable extends Error {
  constructor() {
    super("The gym database is not configured");
    this.name = "STORE_UNAVAILABLE";
  }
}

export function getRepository(): SparringRepository {
  if (process.env.SPARRING_STORE === "memory") {
    if (process.env.NODE_ENV === "production") throw new StoreUnavailable();
    return createMemoryRepository();
  }
  if (supabaseConfigured()) return createSupabaseRepository();
  throw new StoreUnavailable();
}
