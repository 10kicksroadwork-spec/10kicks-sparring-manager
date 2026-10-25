import { guardRead, guardWrite, respond } from "@/lib/api/guard";
import { sessionCreateSchema } from "@/lib/schemas";
import { createSession, listSessions } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  return respond(await listSessions(actor));
}

export async function POST(req: Request) {
  const guarded = await guardWrite(req, sessionCreateSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await createSession(guarded.actor, guarded.body));
}
