import type { Assignment, Location } from "./types";

/**
 * Within each block, occupied locations must be a prefix of the venue pool
 * (Main ring → Back Mat → Front Mat). Empty slots only on the right.
 */

/** True when used locations are exactly pool[0..k) — no left-side holes. */
export function isContiguousLeftPack(usedLocations: Iterable<Location>, pool: Location[]): boolean {
  const used = new Set(usedLocations);
  if (used.size === 0) return true;
  if (used.size > pool.length) return false;
  for (let i = 0; i < pool.length; i += 1) {
    const shouldHave = i < used.size;
    if (used.has(pool[i]) !== shouldHave) return false;
  }
  return true;
}

/** Target location set for k matches in one block. */
export function prefixLocations(matchCount: number, pool: Location[]): Location[] {
  return pool.slice(0, Math.max(0, Math.min(matchCount, pool.length)));
}

/** Lower is better: penalize holes, then prefer left. */
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

/**
 * Sort location plans: prefix pack first, then fewer per-fighter repeats
 * (variety is preferred but packing + short cards may repeat locations).
 */
export function sortPlansByLeftPack(
  plans: Location[][],
  pool: Location[],
  fixedLocations: Iterable<Location> = [],
  repeatCost: (plan: Location[]) => number = () => 0,
): Location[][] {
  const fixed = [...fixedLocations];
  return plans.slice().sort((a, b) => {
    const penaltyGap =
      leftPackPenalty([...fixed, ...a], pool) - leftPackPenalty([...fixed, ...b], pool);
    if (penaltyGap !== 0) return penaltyGap;
    const repeatGap = repeatCost(a) - repeatCost(b);
    if (repeatGap !== 0) return repeatGap;
    return a.join().localeCompare(b.join());
  });
}

/** Keep only plans that leave the block as a pool prefix once fixed locations are included. */
export function filterPrefixPlans(
  plans: Location[][],
  pool: Location[],
  fixedLocations: Iterable<Location>,
): Location[][] {
  const fixed = [...fixedLocations];
  return plans.filter((plan) => isContiguousLeftPack([...fixed, ...plan], pool));
}

/**
 * Remap one block's movable matches onto the left prefix when fighter location
 * uniqueness allows. Locked/completed rows stay put. Returns null if the hole
 * cannot be closed without touching other blocks.
 */
export function compactBlockToPrefix(
  blockAssignments: Assignment[],
  pool: Location[],
  fighterUsedElsewhere: Map<string, Set<Location>>,
  allowRepeat: boolean,
): Assignment[] | null {
  if (blockAssignments.length === 0) return [];
  if (isContiguousLeftPack(
    blockAssignments.map((row) => row.location),
    pool,
  )) {
    return blockAssignments.map((row) => ({ ...row }));
  }

  const locked = blockAssignments.filter(
    (row) => row.locked || row.status === "COMPLETED" || row.status === "INTERRUPTED",
  );
  const movable = blockAssignments.filter((row) => !locked.includes(row));
  const fixedLocs = locked.map((row) => row.location);
  const target = prefixLocations(blockAssignments.length, pool);
  const remaining = target.filter((location) => !fixedLocs.includes(location));
  if (remaining.length !== movable.length) return null;
  if (new Set(fixedLocs).size !== fixedLocs.length) return null;

  const order = movable.map((row) => row.fighterId);
  const plans: Location[][] = [];
  const walk = (index: number, current: Location[], mask: Set<Location>) => {
    if (index === order.length) {
      plans.push(current.slice());
      return;
    }
    const fighterId = order[index];
    const used = fighterUsedElsewhere.get(fighterId) ?? new Set();
    for (const location of remaining) {
      if (mask.has(location)) continue;
      if (!allowRepeat && used.has(location)) continue;
      current.push(location);
      mask.add(location);
      walk(index + 1, current, mask);
      mask.delete(location);
      current.pop();
    }
  };
  walk(0, [], new Set());
  const ranked = sortPlansByLeftPack(plans, pool, fixedLocs).filter((plan) =>
    isContiguousLeftPack([...fixedLocs, ...plan], pool),
  );
  if (ranked.length === 0) return null;

  const plan = ranked[0];
  const remapped = locked.map((row) => ({ ...row }));
  movable.forEach((row, i) => {
    remapped.push({ ...row, location: plan[i] });
  });
  remapped.sort(
    (a, b) =>
      pool.indexOf(a.location) - pool.indexOf(b.location) ||
      a.fighterId.localeCompare(b.fighterId),
  );
  return remapped;
}

/**
 * Coach Block-4 / Block-6 style holes: shift matches left within a block when possible.
 * Does not change block membership or inflate horizon — only location IDs on movable rows.
 * When allowRepeat is true, never keep a packing hole — fall back to an unconstrained remap.
 */
export function compactScheduleBlocksToPrefix(
  assignments: Assignment[],
  pool: Location[],
  allowRepeat: boolean,
): Assignment[] {
  const byBlock = new Map<number, Assignment[]>();
  for (const row of assignments) {
    const list = byBlock.get(row.blockIndex) ?? [];
    list.push(row);
    byBlock.set(row.blockIndex, list);
  }

  const result: Assignment[] = [];
  for (const [blockIndex, group] of [...byBlock.entries()].sort((a, b) => a[0] - b[0])) {
    const usedElsewhere = new Map<string, Set<Location>>();
    for (const row of group) {
      const used = new Set<Location>();
      for (const other of assignments) {
        if (other.fighterId !== row.fighterId) continue;
        if (other.blockIndex === blockIndex) continue;
        // Prefer post-compaction locations already written for earlier blocks.
        const prior = result.find(
          (done) => done.fighterId === other.fighterId && done.blockIndex === other.blockIndex,
        );
        used.add(prior?.location ?? other.location);
      }
      usedElsewhere.set(row.fighterId, used);
    }
    let compacted = compactBlockToPrefix(group, pool, usedElsewhere, allowRepeat);
    // Hard rule: with repeats allowed, do not publish Main/Back holes (Block 4/6 shapes).
    if (
      allowRepeat &&
      (!compacted || !isContiguousLeftPack(compacted.map((row) => row.location), pool))
    ) {
      compacted = compactBlockToPrefix(group, pool, emptyUsedMap(group), true);
    }
    result.push(...(compacted ?? group.map((row) => ({ ...row }))));
  }
  return result;
}

function emptyUsedMap(group: Assignment[]): Map<string, Set<Location>> {
  const used = new Map<string, Set<Location>>();
  for (const row of group) used.set(row.fighterId, new Set());
  return used;
}
