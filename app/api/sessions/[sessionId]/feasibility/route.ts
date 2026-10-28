import { guardWrite, respond } from "@/lib/api/guard";
import { feasibilitySchema } from "@/lib/schemas";
import { checkMatchupFeasibility } from "@/lib/services/schedule-service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Draft-limit feasibility preview for Session Limits. Does not save or publish. */
export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, feasibilitySchema, ["admin", "coach", "viewer"]);
  if (guarded instanceof Response) return guarded;
  return respond(await checkMatchupFeasibility(guarded.actor, sessionId, guarded.body));
}
