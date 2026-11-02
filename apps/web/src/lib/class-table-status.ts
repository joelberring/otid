/** Klasstabellens statuskolumn (ADR-0169 beslut 4): ett besked per klass, i ordning efter vad som behöver göras. */
export type ClassTableStatus =
  | { kind: "NO_ENTRIES" }
  | { kind: "MISSING_START_TIMES"; count: number }
  | { kind: "MISSING_VARIANTS"; count: number }
  | { kind: "ALL_READ_OUT" }
  | { kind: "WAITING"; count: number }
  | { kind: "READY" };

export function classTableStatus(row: { entryCount: number; readOutCount: number; missingStartTimeCount: number;
  missingVariantCount?: number }): ClassTableStatus {
  if (row.entryCount === 0) return { kind: "NO_ENTRIES" };
  if (row.missingStartTimeCount > 0) return { kind: "MISSING_START_TIMES", count: row.missingStartTimeCount };
  // ADR-0187 beslut 4: en gafflad klass är inte klar för start så länge någon saknar variant.
  if ((row.missingVariantCount ?? 0) > 0 && row.readOutCount < row.entryCount) return { kind: "MISSING_VARIANTS", count: row.missingVariantCount! };
  if (row.readOutCount >= row.entryCount) return { kind: "ALL_READ_OUT" };
  if (row.readOutCount > 0) return { kind: "WAITING", count: row.entryCount - row.readOutCount };
  return { kind: "READY" };
}
