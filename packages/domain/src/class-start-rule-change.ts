import type { StartRule } from "./types";

/** Plan only: caller locks and validates the complete class roster and persists atomically. */
export function planClassStartRuleChange(input: {
  current: StartRule; target: StartRule;
  entries: readonly { id: string; version: number; fixedStartTime: string | null }[];
}) {
  if (!["PUNCH", "FIXED"].includes(input.current) || !["PUNCH", "FIXED"].includes(input.target) ||
    new Set(input.entries.map(entry => entry.id)).size !== input.entries.length) throw new Error("Invalid class start-rule input");
  const changed = input.current !== input.target;
  const entries = input.entries.map(entry => {
    if (!entry.id || !Number.isSafeInteger(entry.version) || entry.version < 1 ||
      (changed && entry.version >= 2_147_483_647)) throw new Error("Invalid entry version");
    return { entryId: entry.id, versionBefore: entry.version, versionAfter: entry.version + (changed ? 1 : 0),
      previousFixedStartTime: entry.fixedStartTime, fixedStartTime: changed ? null : entry.fixedStartTime };
  });
  return { changed, startRule: input.target, entries,
    clearedStartTimes: changed ? input.entries.filter(entry => entry.fixedStartTime !== null).length : 0 };
}
