import { describe, expect, it } from "vitest";
import { partitionCheckIn, type CheckInPerson } from "@/lib/domain/check-in-lists";

function person(partial: Partial<CheckInPerson> & Pick<CheckInPerson, "athleteId" | "displayName">): CheckInPerson {
  return {
    weightLbs: 170,
    skill: 5,
    roleEligibility: "BOTH",
    active: false,
    ...partial,
  };
}

describe("check-in lists", () => {
  it("shows every rated person and drops a fighter from the volunteer list", () => {
    const camp = ["Mason", "Zahra", "Emma", "Stephen", "Malachi"].map((name, index) =>
      person({ athleteId: `camp-${index}`, displayName: name, active: true }),
    );
    const rated = Array.from({ length: 38 }, (_, index) => person({ athleteId: `rated-${index}`, displayName: `Rated ${index}` }));
    const unrated = person({ athleteId: "blank", displayName: "Blank", skill: null, active: true });
    const lists = partitionCheckIn([...camp, ...rated, unrated], []);
    expect(lists.fighters).toHaveLength(5);
    expect(lists.fighters.every((row) => row.active)).toBe(true);
    expect(lists.volunteers).toHaveLength(43);
    expect(lists.fighters.map((row) => row.athleteId)).not.toContain("blank");
    expect(lists.volunteers.map((row) => row.athleteId)).not.toContain("blank");

    const checked = partitionCheckIn(
      [...camp, ...rated, unrated],
      camp.map((row) => ({ athleteId: row.athleteId, assignedRole: "FIGHTER" as const, present: true, availabilityStatus: "AVAILABLE" })),
    );
    expect(checked.fighters).toHaveLength(5);
    expect(checked.volunteers).toHaveLength(38);
    for (const row of camp) {
      expect(checked.volunteers.map((person) => person.athleteId)).not.toContain(row.athleteId);
    }
    expect(checked.volunteers.every((row) => row.active === false)).toBe(true);
  });

  it("keeps a volunteer off the fighter list", () => {
    const people = [person({ athleteId: "a", displayName: "A", active: true })];
    const lists = partitionCheckIn(people, [
      { athleteId: "a", assignedRole: "VOLUNTEER", present: true, availabilityStatus: "AVAILABLE" },
    ]);
    expect(lists.fighters).toHaveLength(0);
    expect(lists.volunteers.map((row) => row.athleteId)).toEqual(["a"]);
  });
});
