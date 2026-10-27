export type IntegrationStatus = {
  auth: "off" | "configured" | "missing";
  supabase: "connected" | "missing";
  lock: "postgres" | "redis" | "missing";
  store: "memory" | "supabase" | "missing";
};

/** Google sign-in is optional. Unset means the desk is open. */
export function authRequired(): boolean {
  const raw = process.env.AUTH_REQUIRED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function serverEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function supabaseUrl(): string {
  return serverEnv("NEXT_PUBLIC_SUPABASE_URL") || serverEnv("SUPABASE_URL");
}

/** True when the server can reach Postgres. The service role key is never public. */
export function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && serverEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

/** Names only. Never log or return secret values. */
export function integrationStatus(): IntegrationStatus {
  const memory = process.env.SPARRING_STORE === "memory" && process.env.NODE_ENV !== "production";
  const supabase = supabaseConfigured();
  const redis = Boolean(serverEnv("UPSTASH_REDIS_REST_URL") && serverEnv("UPSTASH_REDIS_REST_TOKEN"));
  const google = Boolean(serverEnv("AUTH_SECRET") && serverEnv("AUTH_GOOGLE_ID") && serverEnv("AUTH_GOOGLE_SECRET"));
  return {
    auth: authRequired() ? (google ? "configured" : "missing") : "off",
    supabase: supabase ? "connected" : "missing",
    lock: memory ? "missing" : supabase ? "postgres" : redis ? "redis" : "missing",
    store: memory ? "memory" : supabase ? "supabase" : "missing",
  };
}

export function appTimezone(): string {
  return process.env.APP_TIMEZONE?.trim() || "America/New_York";
}
