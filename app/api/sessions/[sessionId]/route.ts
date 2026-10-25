import { guardRead, guardWrite, respond } from "@/lib/api/guard";
import { confirmSchema } from "@/lib/schemas";
import { cancelSession, getSession } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  return respond(await getSession(actor, sessionId));
}

export async function DELETE(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, confirmSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await cancelSession(guarded.actor, sessionId, guarded.body));
}
