import { integrationStatus, type IntegrationStatus } from "@/lib/env";
import { probeSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const status: IntegrationStatus = { ...integrationStatus() };
  if (status.supabase === "connected") {
    const reachable = await probeSupabase();
    if (!reachable) {
      status.supabase = "missing";
      status.store = status.store === "supabase" ? "missing" : status.store;
      status.lock = status.lock === "postgres" ? "missing" : status.lock;
    }
  }
  return Response.json({
    ok: true,
    data: { service: "10kicks-sparring-manager", ...status },
    revision: null,
    requestId: "health",
  });
}
