export type IntegrationStatus = {
  auth: "configured" | "missing";
  sheets: "configured" | "missing";
  redis: "configured" | "missing";
  store: "memory" | "sheets" | "missing";
};

/** Names only. Never log or return secret values. */
export function integrationStatus(): IntegrationStatus {
  const memory = process.env.SPARRING_STORE === "memory" && process.env.NODE_ENV !== "production";
  const sheets = Boolean(process.env.GOOGLE_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const redis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const auth = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  return {
    auth: auth ? "configured" : "missing",
    sheets: sheets ? "configured" : "missing",
    redis: redis ? "configured" : "missing",
    store: memory ? "memory" : sheets ? "sheets" : "missing",
  };
}

export function appTimezone(): string {
  return process.env.APP_TIMEZONE?.trim() || "America/New_York";
}
