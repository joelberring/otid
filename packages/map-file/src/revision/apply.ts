/**
 * ADR-0207: skriv en ändringssats till en ny fil och kontrollera den. Det här är den enda vägen som appen använder för att
 * lämna ut en reviderad fil: `applyMapRevision` skriver och kontrollerar, och vägrar om kontrollen hittar något.
 */
import type { MapRevisionApplyResult, MapRevisionChangeSet } from "./change-set";

/**
 * Lappar `original` med ändringarna och kontrollerar resultatet (`verifyMapRevision`). `original` ändras aldrig; de nya
 * bytesen sparas som en ny kartversion bredvid originalet.
 */
export function applyMapRevision(original: Uint8Array, changeSet: MapRevisionChangeSet): MapRevisionApplyResult {
  void original; void changeSet;
  return { ok: false, refusals: [{ code: "UNSUPPORTED_VERSION", message: "Skrivningen är inte klar än." }] };
}
