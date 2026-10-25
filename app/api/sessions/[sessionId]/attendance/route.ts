import { guardWrite, respond } from "@/lib/api/guard";
import { attendancePutSchema } from "@/lib/schemas";
import { putAttendance } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function PUT(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, attendancePutSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await putAttendance(guarded.actor, sessionId, guarded.body));
}
