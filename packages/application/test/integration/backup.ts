import { openRaceBackup } from "../../src/race-restore";

/** Säkerhetskopian (ADR-0187) som tabeller, för testerna som kontrollerar vad som följer med. */
export function readBackup(bytes: Uint8Array) {
  const opened = openRaceBackup(bytes);
  if ("status" in opened) throw new Error(`Säkerhetskopian kunde inte läsas: ${JSON.stringify(opened.problem)}`);
  return {
    manifest: opened.manifest,
    people: opened.people,
    table: <T = Record<string, unknown>>(name: string) => opened.table(name) as T[],
    file: (ref: unknown) => Buffer.from(opened.file((ref as { fil: string }).fil))
  };
}
