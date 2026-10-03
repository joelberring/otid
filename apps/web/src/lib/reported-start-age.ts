/** Age at report generation, never a running race time based on the device clock. */
export function reportedStartMinutes(observedAt: string | null, generatedAt: string): number | null {
  if (observedAt === null) return null;
  const elapsed = Date.parse(generatedAt) - Date.parse(observedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 60_000) : null;
}
