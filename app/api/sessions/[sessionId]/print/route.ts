import { guardRead, respond } from "@/lib/api/guard";
import { getSession } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  return respond(await getSession(actor, sessionId, "print"));
}
