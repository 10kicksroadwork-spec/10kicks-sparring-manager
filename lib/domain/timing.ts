export type RoundTiming = { roundMinutes: number; restSeconds: number };

export type DurationEstimate = {
  blockCount: number;
  roundCount: number;
  restCount: number;
  totalSeconds: number;
};

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
  if (!Number.isInteger(timing.roundMinutes) || timing.roundMinutes < 1 || !Number.isInteger(timing.restSeconds) || timing.restSeconds < 0) {
    throw new RangeError("Round minutes must be positive and rest seconds must be nonnegative integers.");
  }
  const roundCount = blockCount * hardRoundsPerBlock;
  const restCount = Math.max(0, roundCount - 1);
  return {
    blockCount,
    roundCount,
    restCount,
    totalSeconds: roundCount * timing.roundMinutes * 60 + restCount * timing.restSeconds,
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
