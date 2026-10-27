import { describe, expect, it } from "vitest";
import {
  formatBlockList,
  otherHardBlocksForVolunteer,
  swapMultiBlockToastMessage,
  volunteersInMultipleHardBlocks,
} from "@/lib/domain/volunteer-load";
import type { AssignmentStatus } from "@/lib/domain/types";

function row(
  assignmentId: string,
  volunteerId: string,
  blockIndex: number,
  status: AssignmentStatus = "PLANNED",
) {
  return { assignmentId, volunteerId, blockIndex, status };
}

describe("volunteer-load helpers", () => {
  it("lists other hard blocks for a volunteer excluding the swapped assignment", () => {
    const assignments = [
      row("a1", "v1", 2),
      row("a2", "v1", 6),
      row("a3", "v2", 3),
      row("a4", "v1", 4, "INTERRUPTED"),
    ];
    expect(otherHardBlocksForVolunteer(assignments, "v1", "a1")).toEqual([6]);
    expect(otherHardBlocksForVolunteer(assignments, "v1")).toEqual([2, 6]);
    expect(otherHardBlocksForVolunteer(assignments, "v2", "a3")).toEqual([]);
  });

  it("finds volunteers who appear in multiple hard blocks", () => {
    const assignments = [
      row("a1", "v1", 2),
      row("a2", "v1", 6),
      row("a3", "v2", 3),
      row("a4", "v3", 1),
      row("a5", "v3", 5),
      row("a6", "v3", 5),
    ];
    const names = new Map([
      ["v1", "Alex"],
      ["v2", "Blake"],
      ["v3", "Casey"],
    ]);
    expect(volunteersInMultipleHardBlocks(assignments, names)).toEqual([
      { volunteerId: "v1", displayName: "Alex", blocks: [2, 6] },
      { volunteerId: "v3", displayName: "Casey", blocks: [1, 5] },
    ]);
  });

  it("ignores interrupted rows when scanning multi-block volunteers", () => {
    const assignments = [row("a1", "v1", 2), row("a2", "v1", 6, "INTERRUPTED")];
    expect(volunteersInMultipleHardBlocks(assignments, () => "Alex")).toEqual([]);
  });

  it("formats block lists and toast copy for coaches", () => {
    expect(formatBlockList([6])).toBe("Block 6");
    expect(formatBlockList([2, 6])).toBe("Blocks 2 and 6");
    expect(formatBlockList([1, 3, 5])).toBe("Blocks 1, 3, and 5");
    expect(swapMultiBlockToastMessage("Alex", [])).toBeNull();
    expect(swapMultiBlockToastMessage("Alex", [6])).toBe("Alex is also slated for Block 6.");
    expect(swapMultiBlockToastMessage("Alex", [2, 6])).toBe("Alex is also slated for Blocks 2 and 6.");
  });
});
