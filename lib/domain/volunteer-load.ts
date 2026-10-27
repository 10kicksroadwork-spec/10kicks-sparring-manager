import { countsAsHardSession, type AssignmentStatus } from "./types";

export type HardAssignmentRef = {
  assignmentId: string;
  volunteerId: string;
  blockIndex: number;
  status: AssignmentStatus;
};

export type VolunteerMultiBlock = {
  volunteerId: string;
  displayName: string;
  /** Sorted unique block indexes where this volunteer has a hard assignment. */
  blocks: number[];
};

function resolveName(volunteerId: string, names: Map<string, string> | ((id: string) => string)): string {
  if (typeof names === "function") return names(volunteerId);
  return names.get(volunteerId) ?? "Unknown";
}

/** Other hard-assignment blocks for a volunteer, excluding one assignment (e.g. the match just swapped). */
export function otherHardBlocksForVolunteer(
  assignments: HardAssignmentRef[],
  volunteerId: string,
  excludeAssignmentId?: string,
): number[] {
  const blocks = new Set<number>();
  for (const row of assignments) {
    if (row.volunteerId !== volunteerId) continue;
    if (excludeAssignmentId && row.assignmentId === excludeAssignmentId) continue;
    if (!countsAsHardSession(row.status)) continue;
    blocks.add(row.blockIndex);
  }
  return [...blocks].sort((a, b) => a - b);
}

/** Volunteers with hard assignments in two or more blocks on the active rundown. */
export function volunteersInMultipleHardBlocks(
  assignments: HardAssignmentRef[],
  names: Map<string, string> | ((id: string) => string),
): VolunteerMultiBlock[] {
  const byVolunteer = new Map<string, Set<number>>();
  for (const row of assignments) {
    if (!countsAsHardSession(row.status)) continue;
    let blocks = byVolunteer.get(row.volunteerId);
    if (!blocks) {
      blocks = new Set();
      byVolunteer.set(row.volunteerId, blocks);
    }
    blocks.add(row.blockIndex);
  }
  const result: VolunteerMultiBlock[] = [];
  for (const [volunteerId, blocks] of byVolunteer) {
    if (blocks.size < 2) continue;
    result.push({
      volunteerId,
      displayName: resolveName(volunteerId, names),
      blocks: [...blocks].sort((a, b) => a - b),
    });
  }
  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function formatBlockList(blocks: number[]): string {
  if (blocks.length === 0) return "";
  if (blocks.length === 1) return `Block ${blocks[0]}`;
  if (blocks.length === 2) return `Blocks ${blocks[0]} and ${blocks[1]}`;
  const head = blocks.slice(0, -1).map((n) => String(n)).join(", ");
  return `Blocks ${head}, and ${blocks[blocks.length - 1]}`;
}

/** Coach-facing toast after swapping a volunteer who remains on other hard blocks. */
export function swapMultiBlockToastMessage(displayName: string, otherBlocks: number[]): string | null {
  if (otherBlocks.length === 0) return null;
  return `${displayName} is also slated for ${formatBlockList(otherBlocks)}.`;
}
