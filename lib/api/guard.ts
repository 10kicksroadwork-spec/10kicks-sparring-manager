import { z } from "zod";
import { sessionIdentity } from "@/lib/auth";
import { authRequired } from "@/lib/env";
import { roleForEmail, type Role } from "@/lib/permissions";
import { formatZodError } from "@/lib/schemas";
import type { Actor, ServiceResult } from "@/lib/services/support";

const LOCAL_COACH: Actor = { email: "local-coach@sparring.local", role: "coach" };

const hits = new Map<string, number[]>();

function testEmail(req: Request): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.E2E_TEST_AUTH !== "1") return null;
  const header = req.headers.get("x-test-user-email")?.trim().toLowerCase();
  if (header) return header;
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|; )sparring_test_user=([^;]+)/);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : null;
}

export function testAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.E2E_TEST_AUTH === "1";
}

export async function identify(req: Request): Promise<{ actor: Actor | null; authenticated: boolean }> {
  const test = testEmail(req);
  if (test) {
    const role = roleForEmail(test);
    return { actor: role ? { email: test, role } : null, authenticated: true };
  }
  if (!authRequired()) return { actor: LOCAL_COACH, authenticated: true };
  const session = await sessionIdentity();
  if (!session) return { actor: null, authenticated: false };
  if (!session.role) return { actor: null, authenticated: true };
  return { actor: { email: session.email, role: session.role }, authenticated: true };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? safeHost(req.url);
  if (!origin) return req.headers.get("x-requested-with") === "sparring-manager";
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function allowRate(key: string, limit = 180): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function respond<T>(result: ServiceResult<T>): Response {
  if (!result.ok) {
    return Response.json(
      { ok: false, error: { code: result.code, message: result.message, details: result.details ?? {} }, requestId: result.requestId },
      { status: result.status },
    );
  }
  return Response.json({ ok: true, data: result.data, revision: result.revision ?? null, requestId: result.requestId });
}

export async function guardRead(req: Request, roles: Role[]): Promise<Actor | Response> {
  const { actor, authenticated } = await identify(req);
  if (!authenticated) {
    return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Sign in required.", details: {} }, requestId: "read" }, { status: 401 });
  }
  if (!actor || !roles.includes(actor.role)) {
    return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "This Google account is not on the coach list.", details: {} }, requestId: "read" }, { status: 403 });
  }
  return actor;
}

export async function guardWrite<S>(req: Request, schema: z.ZodType<S>, roles: Role[]): Promise<{ actor: Actor; body: S } | Response> {
  const identity = await guardRead(req, roles);
  if (identity instanceof Response) return identity;
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: { code: "BAD_ORIGIN", message: "Open the app and try that action again.", details: {} }, requestId: "write" }, { status: 403 });
  }
  if (!allowRate(identity.email)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMIT", message: "Too many saves. Wait a minute and try again.", details: {} }, requestId: "write" }, { status: 429 });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = null;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "BAD_REQUEST", message: formatZodError(parsed.error), details: {} }, requestId: "write" },
      { status: 400 },
    );
  }
  return { actor: identity, body: parsed.data };
}
