import { guardWrite, respond } from "@/lib/api/guard";
import { recommendedLimitsSchema } from "@/lib/schemas";
import { checkRecommendedMinimumLimits } from "@/lib/services/schedule-service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Joint minimum (skill, lbs) for Session Limits auto-fill. Does not save or publish. */
export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, recommendedLimitsSchema, ["admin", "coach", "viewer"]);
  if (guarded instanceof Response) return guarded;
  return respond(await checkRecommendedMinimumLimits(guarded.actor, sessionId, guarded.body));
}
