import { isReadyForHardMatch } from "./profile";

export type CheckInPerson = {
  athleteId: string;
  displayName: string;
  weightLbs: number | null;
  skill: number | null;
  roleEligibility: string;
  active: boolean;
};

export type CheckedRole = {
  athleteId: string;
  assignedRole: "FIGHTER" | "VOLUNTEER";
  present: boolean;
  availabilityStatus: string;
};

/**
 * The fighter list is the active camp. Volunteers are every other rated person.
 * A person present as a fighter is not offered as a volunteer.
 */
export function partitionCheckIn<T extends CheckInPerson>(athletes: T[], attendance: CheckedRole[]) {
  const checked = new Map(
    attendance
      .filter((row) => row.present && row.availabilityStatus === "AVAILABLE")
      .map((row) => [row.athleteId, row.assignedRole]),
  );
  const rated = athletes.filter((athlete) => isReadyForHardMatch(athlete));
  const byName = (a: CheckInPerson, b: CheckInPerson) => a.displayName.localeCompare(b.displayName);
  const fighters = rated
    .filter((athlete) => athlete.active && athlete.roleEligibility !== "VOLUNTEER" && checked.get(athlete.athleteId) !== "VOLUNTEER")
    .sort(byName);
  const volunteers = rated
    .filter((athlete) => athlete.roleEligibility !== "FIGHTER" && checked.get(athlete.athleteId) !== "FIGHTER")
    .sort((a, b) => Number(a.active) - Number(b.active) || byName(a, b));
  return { fighters, volunteers };
}
