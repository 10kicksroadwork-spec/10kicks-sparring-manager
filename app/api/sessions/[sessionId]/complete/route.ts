import { guardWrite, respond } from "@/lib/api/guard";
import { completeSessionSchema } from "@/lib/schemas";
import { completeSession } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, completeSessionSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await completeSession(guarded.actor, sessionId, guarded.body));
}
