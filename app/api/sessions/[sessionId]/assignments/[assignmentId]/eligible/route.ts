import { guardRead, respond } from "@/lib/api/guard";
import { listAssignmentSwapOptions } from "@/lib/services/schedule-service";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ sessionId: string; assignmentId: string }> }) {
  const { sessionId, assignmentId } = await context.params;
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  return respond(await listAssignmentSwapOptions(actor, sessionId, assignmentId));
}
