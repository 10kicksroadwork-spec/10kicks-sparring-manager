import { testAuthEnabled } from "@/lib/api/guard";
import { roleForEmail } from "@/lib/permissions";

export const runtime = "nodejs";

/** Test-only sign-in. Refuses to run in production. */
export async function POST(req: Request) {
  if (!testAuthEnabled()) {
    return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found.", details: {} }, requestId: "test" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!email || !roleForEmail(email)) {
    return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "That account is not allowlisted.", details: {} }, requestId: "test" }, { status: 403 });
  }
  return new Response(JSON.stringify({ ok: true, data: { email }, revision: null, requestId: "test" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `sparring_test_user=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax`,
    },
  });
}
