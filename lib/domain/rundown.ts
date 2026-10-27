/** A rundown has started when a match is locked, underway, finished, or interrupted. */
export function rundownStarted(status: string, assignments: { status: string; locked: boolean }[]): boolean {
  if (status === "IN_PROGRESS" || status === "COMPLETED") return true;
  return assignments.some(
    (row) => row.locked || row.status === "COMPLETED" || row.status === "IN_PROGRESS" || row.status === "INTERRUPTED",
  );
}
