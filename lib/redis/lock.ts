import { Redis } from "@upstash/redis";
import { supabaseConfigured } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type LockManager = {
  mode: "redis" | "postgres" | "memory" | "unavailable";
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
};

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

type MemoryLock = { token: string; expires: number };
const locks = new Map<string, MemoryLock>();

export function createMemoryLock(): LockManager {
  return {
    mode: "memory",
    async acquire(key, token, ttlMs) {
      const current = locks.get(key);
      if (current && current.expires > Date.now()) return false;
      locks.set(key, { token, expires: Date.now() + ttlMs });
      return true;
    },
    async release(key, token) {
      const current = locks.get(key);
      if (current?.token === token) locks.delete(key);
    },
  };
}

export function createUnavailableLock(): LockManager {
  return {
    mode: "unavailable",
    async acquire() {
      return false;
    },
    async release() {
      return undefined;
    },
  };
}

let redisClient: Redis | null = null;

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redisClient) redisClient = new Redis({ url, token });
  return redisClient;
}

function lockFailed(): Error {
  const error = new Error("The database lock could not run");
  error.name = "LOCK_UNAVAILABLE";
  return error;
}

export function createPostgresLock(): LockManager {
  return {
    mode: "postgres",
    async acquire(key, token, ttlMs) {
      const { data, error } = await getSupabaseAdmin().rpc("acquire_sparring_lock", {
        p_key: key,
        p_token: token,
        p_ttl_ms: ttlMs,
      });
      if (error) throw lockFailed();
      return data === true;
    },
    async release(key, token) {
      const { error } = await getSupabaseAdmin().rpc("release_sparring_lock", { p_key: key, p_token: token });
      if (error) console.error("lock release failed");
    },
  };
}

export function createRedisLock(): LockManager {
  return {
    mode: "redis",
    async acquire(key, token, ttlMs) {
      const client = redis();
      if (!client) return false;
      const result = await client.set(key, token, { nx: true, px: ttlMs });
      return result === "OK";
    },
    async release(key, token) {
      const client = redis();
      if (!client) return;
      await client.eval(RELEASE_SCRIPT, [key], [token]);
    },
  };
}

let testLock: LockManager | null = null;

/** Test hook. Ignored in production so a test double cannot weaken live writes. */
export function setLockManagerForTests(lock: LockManager | null): void {
  if (process.env.NODE_ENV === "production") return;
  testLock = lock;
}

/** Production writes use a Postgres lock on the Supabase project. Redis stays optional. */
export function getLockManager(): LockManager {
  if (process.env.NODE_ENV !== "production" && testLock) return testLock;
  const memoryAllowed = process.env.SPARRING_STORE === "memory" && process.env.NODE_ENV !== "production";
  if (memoryAllowed) return createMemoryLock();
  if (supabaseConfigured()) return createPostgresLock();
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return createRedisLock();
  return createUnavailableLock();
}

export function resetMemoryLocks(): void {
  locks.clear();
}
