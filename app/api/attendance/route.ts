import { guardRead, respond } from "@/lib/api/guard";
import { listVolunteerAttendance } from "@/lib/services/volunteer-attendance";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const actor = await guardRead(req, ["admin", "coach", "viewer"]);
  if (actor instanceof Response) return actor;
  return respond(await listVolunteerAttendance(actor));
}
