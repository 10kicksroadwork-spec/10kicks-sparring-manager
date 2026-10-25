import { guardWrite, respond } from "@/lib/api/guard";
import { generateSchema } from "@/lib/schemas";
import { regenerate } from "@/lib/services/schedule-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, generateSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await regenerate(guarded.actor, sessionId, guarded.body));
}
