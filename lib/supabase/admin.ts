import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfigured, supabaseUrl } from "@/lib/env";

let client: SupabaseClient | null = null;

function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseConfigured()) {
    const error = new Error("Supabase is not configured");
    error.name = "STORE_UNAVAILABLE";
    throw error;
  }
  if (!client) {
    client = createClient(supabaseUrl(), serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

export async function probeSupabase(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const { error } = await getSupabaseAdmin().from("athletes").select("athlete_id").limit(1);
    return !error;
  } catch {
    return false;
  }
}
