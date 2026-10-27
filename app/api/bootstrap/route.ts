import { guardRead, respond } from "@/lib/api/guard";
import { integrationStatus } from "@/lib/env";
import { listAthletes } from "@/lib/services/athlete-service";
import { listSessions } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  const [athletes, sessions] = await Promise.all([listAthletes(actor), listSessions(actor)]);
  if (!athletes.ok || !sessions.ok) {
    const failure = !athletes.ok ? athletes : sessions;
    if (!failure.ok && (failure.code === "STORE_NOT_CONFIGURED" || failure.code === "SHEETS_NOT_CONFIGURED")) {
      return respond({
        ok: true,
        requestId: "bootstrap",
        data: {
          actor,
          activeSessionId: null,
          athleteCount: 0,
          sessions: [],
          corrupt: [],
          integrations: integrationStatus(),
        },
      });
    }
    return respond(failure);
  }
  const active = sessions.data.sessions.find((session) => session.status === "DRAFT" || session.status === "READY" || session.status === "IN_PROGRESS");
  return respond({
    ok: true,
    requestId: "bootstrap",
    data: {
      actor,
      activeSessionId: active?.sessionId ?? null,
      athleteCount: athletes.data.athletes.length,
      sessions: sessions.data.sessions.slice(0, 12),
      corrupt: [...athletes.data.corrupt, ...sessions.data.corrupt],
      integrations: integrationStatus(),
    },
  });
}
