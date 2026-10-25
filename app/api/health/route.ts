import { integrationStatus } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const status = integrationStatus();
  return Response.json({
    ok: true,
    data: { service: "10kicks-sparring-manager", ...status },
    revision: null,
    requestId: "health",
  });
}
