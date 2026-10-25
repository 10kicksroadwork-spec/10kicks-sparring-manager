import { guardWrite, respond } from "@/lib/api/guard";
import { restrictionSchema } from "@/lib/schemas";
import { createRestriction } from "@/lib/services/schedule-service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const guarded = await guardWrite(req, restrictionSchema, ["admin"]);
  if (guarded instanceof Response) return guarded;
  return respond(await createRestriction(guarded.actor, guarded.body));
}
