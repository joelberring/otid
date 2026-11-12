import { courseVariantForReadout } from "./evaluate-card-readout";
import { withProposedEntryVariants } from "./course-variants";
import type { EvaluationReadout, RaceSnapshot } from "./types";

/**
 * Okänd bricka och gafflad bana (användartestet 2026-11-12, fel C och D). När en okänd bricka kopplas till en löpare bedöms
 * avläsningen mot varianten som stämplingarna passar. Skiljer den sig från löparens tilldelade variant (löparen tog fel
 * karta, eller brickan är någon annans) ska bytet synas i beskedet, deltagarkortet och historiken.
 */

/** Varianten av löparens bana som stämplingarna passar bäst, oavsett tilldelad variant. Saknas utan gafflad bana. */
export function fittingVariantForEntry(readout: EvaluationReadout, snapshot: RaceSnapshot, entryId: string): string | undefined {
  const entry = snapshot.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return undefined;
  // Brickan prövas som om den vore löparens och löparen saknade variant: då väljs varianten efter stämplingarna.
  const probe: RaceSnapshot = { ...withProposedEntryVariants(snapshot, new Map([[entryId, null]])),
    cardAssignments: [{ id: entryId, raceId: entry.raceId, entryId, cardNumber: readout.cardNumber, active: true }] };
  return courseVariantForReadout(readout, probe)?.code;
}

export interface LinkVariantChange {
  readonly assignedCode: string;
  readonly fittingCode: string;
}

/** Löparens tilldelade variant och den som stämplingarna passar, när löparen har en variant och de skiljer sig. */
export function linkVariantChange(readout: EvaluationReadout, snapshot: RaceSnapshot, entryId: string): LinkVariantChange | undefined {
  const assignedCode = snapshot.entries.find((candidate) => candidate.id === entryId)?.courseVariantCode;
  if (!assignedCode) return undefined;
  const fittingCode = fittingVariantForEntry(readout, snapshot, entryId);
  return fittingCode && fittingCode !== assignedCode ? { assignedCode, fittingCode } : undefined;
}
