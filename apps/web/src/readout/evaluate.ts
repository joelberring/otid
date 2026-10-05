import type { ReadoutPackage, SportidentReadoutPayload } from "@o-tid/contracts";
import { courseVariantForReadout, evaluateCardReadout, type EvaluationResult, type RaceSnapshot, type RogainingScore } from "@o-tid/domain";
import { localRelay, relaySnapshot, type LocalRelay } from "./relay";

/** Det som avläsningsvyn visar direkt efter en avläsning, före serverns svar. */
export interface LocalVerdict {
  readonly status: EvaluationResult["status"];
  readonly reason: EvaluationResult["reason"];
  readonly name?: string;
  readonly className?: string;
  /** Gafflad bana: varianten som avläsningen bedömdes mot; `assigned` är falskt när den valts efter stämplingarna. */
  readonly variant?: { readonly code: string; readonly assigned: boolean };
  readonly elapsedMs?: number;
  readonly missingControls: readonly number[];
  /** Sträcktider: kontrollkod, tid från start och tid för sträckan. */
  readonly splits: readonly { readonly controlCode: number; readonly elapsedMs: number; readonly legMs: number }[];
  /** Stafett: laget, sträckan och lagets resultat efter sträckan. */
  readonly relay?: LocalRelay;
  /** Rogaining (ADR-0170 beslut 5): poäng, straff, summa och de räknade kontrollerna. */
  readonly rogaining?: RogainingScore;
}

/**
 * Bedömer avläsningen lokalt mot det senast hämtade paketet med samma
 * resultatmotor som servern. Serverns svar är det som gäller. `local` är tidigare
 * avläsningar i den här webbläsaren: en stafettsträckas start är föregående sträckas mål.
 */
export function evaluateLocally(payload: SportidentReadoutPayload, pkg: ReadoutPackage,
  local: readonly SportidentReadoutPayload[] = []): LocalVerdict {
  const readout = {
    cardNumber: payload.cardNumber,
    ...(payload.startPunchedAt ? { startPunchedAt: payload.startPunchedAt } : {}),
    ...(payload.finishPunchedAt ? { finishPunchedAt: payload.finishPunchedAt } : {}),
    punches: payload.punches
  };
  const owner = pkg.raceSnapshot.cardAssignments.find((assignment) => assignment.active && assignment.cardNumber === payload.cardNumber);
  const earlier = local.filter((candidate) => candidate !== payload);
  // Kontraktets valfria fält tillåter uttryckligt undefined; resultatmotorn läser dem inte.
  const snapshot = owner ? relaySnapshot(pkg, owner.entryId, earlier) : pkg.raceSnapshot as RaceSnapshot;
  const result = evaluateCardReadout(readout, snapshot);
  const variant = result.entryId ? courseVariantForReadout(readout, snapshot) : undefined;
  const entry = result.entryId ? pkg.raceSnapshot.entries.find((candidate) => candidate.id === result.entryId) : undefined;
  const raceClass = result.classId ? pkg.raceSnapshot.classes.find((candidate) => candidate.id === result.classId) : undefined;
  const relay = result.entryId && result.status !== "UNKNOWN_CARD" ? localRelay(pkg, result.entryId, { status: result.status,
    ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}) }, earlier) : undefined;
  return {
    ...(relay ? { relay } : {}),
    status: result.status,
    reason: result.reason,
    ...(entry ? { name: `${entry.givenName} ${entry.familyName}`.trim() } : {}),
    ...(raceClass ? { className: raceClass.name } : {}),
    ...(variant ? { variant } : {}),
    ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
    ...(result.rogaining ? { rogaining: result.rogaining } : {}),
    missingControls: result.missingControls,
    splits: result.splits.map((split) => ({ controlCode: split.controlCode, elapsedMs: split.elapsedMs, legMs: split.legMs }))
  };
}

/** Löptid som t:mm:ss eller m:ss. */
export function formatRunningTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
