import { z } from "zod";
import { guardRead, guardWrite, respond } from "@/lib/api/guard";
import { athleteCreateSchema } from "@/lib/schemas";
import { createAthlete, listAthletes } from "@/lib/services/athlete-service";

export const runtime = "nodejs";

const createSchema = athleteCreateSchema.extend({ requestId: z.string().trim().min(8).max(80) });

export async function GET(req: Request) {
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  return respond(await listAthletes(actor));
}

export async function POST(req: Request) {
  const guarded = await guardWrite(req, createSchema, ["admin", "coach"]);
  if (guarded instanceof Response) return guarded;
  return respond(await createAthlete(guarded.actor, guarded.body));
}
