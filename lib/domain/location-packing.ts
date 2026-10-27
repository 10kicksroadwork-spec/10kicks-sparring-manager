import type { Location } from "./types";

/**
 * Within a block, matches pack left-to-right: Main ring, then Back Mat, then Front Mat.
 * Empty slots should only sit on the right — never leave Main open while a mat is busy
 * when a left-packed assignment is available. This does not expand total block count.
 */

/** True when used locations are a prefix of the venue pool (no left-side holes). */
export function isContiguousLeftPack(usedLocations: Iterable<Location>, pool: Location[]): boolean {
  const used = new Set(usedLocations);
  if (used.size === 0) return true;
  let seenGap = false;
  for (const location of pool) {
    if (used.has(location)) {
      if (seenGap) return false;
    } else {
      seenGap = true;
    }
  }
  return true;
}

/** Lower is better: penalize holes (used after an open higher-priority mat), then prefer left. */
export function leftPackPenalty(usedLocations: Iterable<Location>, pool: Location[]): number {
  const used = new Set(usedLocations);
  let penalty = 0;
  let gap = false;
  for (let i = 0; i < pool.length; i += 1) {
    if (used.has(pool[i])) {
      if (gap) penalty += 1000;
      penalty += i;
    } else {
      gap = true;
    }
  }
  return penalty;
}

/** Sort location plans so Main→Back→Front packing is tried first. */
export function sortPlansByLeftPack(plans: Location[][], pool: Location[], fixedLocations: Iterable<Location> = []): Location[][] {
  const fixed = [...fixedLocations];
  return plans.slice().sort((a, b) => {
    const penaltyGap =
      leftPackPenalty([...fixed, ...a], pool) - leftPackPenalty([...fixed, ...b], pool);
    if (penaltyGap !== 0) return penaltyGap;
    return a.join().localeCompare(b.join());
  });
}
