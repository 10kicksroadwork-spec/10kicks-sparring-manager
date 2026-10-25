import { z } from "zod";
import { guardWrite, respond } from "@/lib/api/guard";
import { mutationMeta } from "@/lib/schemas";
import { undoGeneration } from "@/lib/services/schedule-service";

export const runtime = "nodejs";

const schema = z.object(mutationMeta);

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, schema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await undoGeneration(guarded.actor, sessionId, guarded.body));
}
