export type RoundTiming = { roundMinutes: number; restSeconds: number };

export type DurationEstimate = {
  blockCount: number;
  roundCount: number;
  restCount: number;
  totalSeconds: number;
};

/** True when minutes are in [1, 15] on a half-minute grid (1, 1.5, …, 15). */
export function isValidRoundMinutes(roundMinutes: number): boolean {
  if (!Number.isFinite(roundMinutes) || roundMinutes < 1 || roundMinutes > 15) return false;
  return Math.abs(roundMinutes * 2 - Math.round(roundMinutes * 2)) < 1e-9;
}

/**
 * Blocks happen sequentially; sparring areas within a block happen in parallel.
 * One rest interval occurs between consecutive rounds, including block boundaries,
 * but not after the final round.
 */
export function estimateDuration(
  blockCount: number,
  hardRoundsPerBlock: number,
  timing: RoundTiming,
): DurationEstimate {
  if (!Number.isInteger(blockCount) || blockCount < 0 || !Number.isInteger(hardRoundsPerBlock) || hardRoundsPerBlock < 1) {
    throw new RangeError("Block count must be nonnegative; rounds per block must be positive.");
  }
  if (!isValidRoundMinutes(timing.roundMinutes) || !Number.isInteger(timing.restSeconds) || timing.restSeconds < 0) {
    throw new RangeError("Round minutes must be 1–15 in half-minute steps; rest seconds must be a nonnegative integer.");
  }
  const roundCount = blockCount * hardRoundsPerBlock;
  const restCount = Math.max(0, roundCount - 1);
  return {
    blockCount,
    roundCount,
    restCount,
    totalSeconds: Math.round(roundCount * timing.roundMinutes * 60 + restCount * timing.restSeconds),
  };
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) throw new RangeError("Invalid duration.");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : "", seconds ? `${seconds} sec` : ""]
    .filter(Boolean).join(" ") || "0 min";
}
