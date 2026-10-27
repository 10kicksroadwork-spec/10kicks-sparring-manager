import { randomUUID } from "node:crypto";
import { can, type Action, type Role } from "@/lib/permissions";
import { getRepository, StoreUnavailable } from "@/lib/repository";
import type { AuditEvent, CommitBatch, SessionRecord, SparringRepository } from "@/lib/repository/types";
import { getLockManager } from "@/lib/redis/lock";
import { appTimezone } from "@/lib/env";

export type Actor = { email: string; role: Role };

export type ServiceFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
};

export type ServiceSuccess<T> = { ok: true; data: T; revision?: number; requestId: string };
export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export function fail(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ServiceFailure {
  return { ok: false, status, code, message, requestId, details };
}

export class ServiceStop extends Error {
  constructor(public failure: ServiceFailure) {
    super(failure.message);
    this.name = "ServiceStop";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function localToday(timeZone = appTimezone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function openStore(requestId: string): Promise<{ repo: SparringRepository } | ServiceFailure> {
  try {
    return { repo: getRepository() };
  } catch (error) {
    if (error instanceof StoreUnavailable) {
      return fail(503, "STORE_NOT_CONFIGURED", "The gym database is not connected yet. Reads and writes are unavailable.", requestId);
    }
    throw error;
  }
}

async function auditByRequest(repo: SparringRepository, requestId: string, sessionId?: string): Promise<AuditEvent | null> {
  const audit = await repo.readAudit(sessionId);
  return audit.rows.find((row) => row.requestId === requestId) ?? null;
}

export function replay<T>(event: AuditEvent): ServiceSuccess<T> | null {
  if (!("data" in event.payload)) return null;
  return { ok: true, data: event.payload.data as T, revision: event.newRevision, requestId: event.requestId };
}

export async function withWrite<T>(args: {
  actor: Actor;
  action: Action;
  sessionId: string;
  expectedRevision: number | null;
  requestId: string;
  eventType: string;
    run: (ctx: { repo: SparringRepository; session: SessionRecord | null; now: string }) => Promise<{
      data: T;
      session?: SessionRecord | null;
      batch?: Omit<CommitBatch, "audit" | "session">;
      payload?: Record<string, unknown>;
      auditSessionId?: string;
    }>;
}): Promise<ServiceResult<T>> {
  if (!can(args.actor.role, args.action)) {
    return fail(403, "FORBIDDEN", "Your account cannot do that.", args.requestId);
  }
  const opened = await openStore(args.requestId);
  if ("ok" in opened) return opened;
  const { repo } = opened;
  const lock = getLockManager();
  if (lock.mode === "unavailable") {
    return fail(503, "REDIS_UNAVAILABLE", "Writes are paused because the database lock is not configured. Nothing was saved.", args.requestId);
  }
  const existing = await auditByRequest(repo, args.requestId, args.sessionId || undefined);
  const replayed = existing ? replay<T>(existing) : null;
  if (replayed) return replayed;

  const token = randomUUID();
  const key = args.sessionId ? `lock:session:${args.sessionId}` : "lock:roster";
  const acquired = await lock.acquire(key, token, 20_000);
  if (!acquired) {
    return fail(423, "LOCKED", "Another save is in progress. Wait a second and try again.", args.requestId);
  }
  try {
    const again = await auditByRequest(repo, args.requestId, args.sessionId || undefined);
    const second = again ? replay<T>(again) : null;
    if (second) return second;
    let session: SessionRecord | null = null;
    if (args.sessionId) {
      const sessions = await repo.readSessions();
      session = sessions.rows.find((row) => row.sessionId === args.sessionId) ?? null;
      if (!session) return fail(404, "NOT_FOUND", "That session does not exist.", args.requestId);
      if (args.expectedRevision !== null && session.revision !== args.expectedRevision) {
        return fail(409, "STALE_REVISION", "Another coach updated this session. Refresh the rundown.", args.requestId, {
          revision: session.revision,
        });
      }
    }
    const now = nowIso();
    const result = await args.run({ repo, session, now });
    const payload = { ...(result.payload ?? {}), data: result.data };
    let savedSession: SessionRecord | undefined;
    let prior = session?.revision ?? 0;
    let nextRevision = prior;
    if (result.session) {
      prior = result.session.revision;
      savedSession = {
        ...result.session,
        revision: prior + 1,
        updatedAt: now,
        updatedBy: args.actor.email,
      };
      nextRevision = savedSession.revision;
    }
    await repo.commit({
      ...(savedSession ? { session: savedSession } : {}),
      ...(result.batch ?? {}),
      audit: {
        auditId: randomUUID(),
        sessionId: result.auditSessionId || savedSession?.sessionId || args.sessionId || "roster",
        actorEmail: args.actor.email,
        eventType: args.eventType,
        requestId: args.requestId,
        priorRevision: prior,
        newRevision: nextRevision,
        timestamp: now,
        payload,
      },
    });
    return { ok: true, data: result.data, revision: savedSession ? nextRevision : undefined, requestId: args.requestId };
  } catch (error) {
    if (error instanceof ServiceStop) return error.failure;
    if (error instanceof Error && error.name === "LOCK_UNAVAILABLE") {
      return fail(503, "LOCK_UNAVAILABLE", "Writes are paused because the database lock is not configured. Nothing was saved.", args.requestId);
    }
    if (error instanceof Error && error.name === "STORE_UNAVAILABLE") {
      return fail(503, "STORE_NOT_CONFIGURED", "The gym database is not connected yet. Nothing was saved.", args.requestId);
    }
    if (error instanceof Error && error.name === "STORE_FAILED") {
      return fail(503, "STORE_FAILED", "The database did not confirm the save. Refresh and try again.", args.requestId);
    }
    console.error("mutation failed", args.eventType);
    return fail(500, "SAVE_FAILED", "The save failed. Refresh and try again.", args.requestId);
  } finally {
    await lock.release(key, token);
  }
}
