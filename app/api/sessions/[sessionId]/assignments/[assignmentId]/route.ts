import { guardWrite, respond } from "@/lib/api/guard";
import { assignmentPatchSchema } from "@/lib/schemas";
import { patchAssignment } from "@/lib/services/schedule-service";

export const runtime = "nodejs";

export async function PATCH(req: Request, context: { params: Promise<{ sessionId: string; assignmentId: string }> }) {
  const { sessionId, assignmentId } = await context.params;
  const guarded = await guardWrite(req, assignmentPatchSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await patchAssignment(guarded.actor, sessionId, assignmentId, guarded.body));
}
