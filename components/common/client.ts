export type ApiOk<T> = { ok: true; data: T; revision: number | null; requestId: string };
export type ApiErr = { ok: false; error: { code: string; message: string; details?: Record<string, unknown> }; requestId: string };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiOk<T> | ApiErr> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-requested-with": "sparring-manager",
      ...(init?.headers ?? {}),
    },
  });
  return (await response.json()) as ApiOk<T> | ApiErr;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export { locationLabel } from "@/lib/domain/types";
