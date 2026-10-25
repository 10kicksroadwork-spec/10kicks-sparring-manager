import { guardWrite, respond } from "@/lib/api/guard";
import { blockCompleteSchema } from "@/lib/schemas";
import { completeBlock } from "@/lib/services/schedule-service";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ sessionId: string; blockIndex: string }> }) {
  const { sessionId, blockIndex } = await context.params;
  const block = Number(blockIndex);
  if (!Number.isInteger(block) || block < 1) {
    return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Block number is invalid.", details: {} }, requestId: "write" }, { status: 400 });
  }
  const guarded = await guardWrite(req, blockCompleteSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await completeBlock(guarded.actor, sessionId, block, guarded.body));
}
