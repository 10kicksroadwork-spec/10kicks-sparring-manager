import type { ConflictCode, ConflictDiagnostic } from "./types";

/** Coach swaps may only be refused for truly illegal card states. */
export const HARD_COACH_SWAP_CODES = new Set<ConflictCode>([
  "EXPLICIT_EXCLUSION",
  "ATHLETE_DOUBLE_BOOKED",
  "ROLE_CONFLICT",
  "UNKNOWN_ATHLETE",
]);

export function partitionCoachSwapDiagnostics(errors: ConflictDiagnostic[]): {
  hard: ConflictDiagnostic[];
  soft: ConflictDiagnostic[];
} {
  const hard: ConflictDiagnostic[] = [];
  const soft: ConflictDiagnostic[] = [];
  for (const error of errors) {
    if (HARD_COACH_SWAP_CODES.has(error.code)) hard.push(error);
    else soft.push(error);
  }
  return { hard, soft };
}

export function coachSwapWarningMessages(
  softErrors: ConflictDiagnostic[],
  softWarnings: ConflictDiagnostic[] = [],
): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const row of [...softErrors, ...softWarnings]) {
    const text = row.message.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    messages.push(text);
  }
  return messages;
}
