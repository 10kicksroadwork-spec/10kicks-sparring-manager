import { guardWrite, respond } from "@/lib/api/guard";
import { settingsSchema } from "@/lib/schemas";
import { updateSettings } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function PUT(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const guarded = await guardWrite(req, settingsSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await updateSettings(guarded.actor, sessionId, guarded.body));
}
