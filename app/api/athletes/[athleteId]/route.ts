import { guardWrite, respond } from "@/lib/api/guard";
import { athletePatchSchema } from "@/lib/schemas";
import { updateAthlete } from "@/lib/services/athlete-service";

export const runtime = "nodejs";

export async function PATCH(req: Request, context: { params: Promise<{ athleteId: string }> }) {
  const { athleteId } = await context.params;
  const guarded = await guardWrite(req, athletePatchSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await updateAthlete(guarded.actor, athleteId, guarded.body));
}
