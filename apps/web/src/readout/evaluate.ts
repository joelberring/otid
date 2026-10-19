import type { ReadoutPackage, SportidentReadoutPayload } from "@o-tid/contracts";
import { courseVariantForReadout, evaluateCardReadout, startPunchNote, type EvaluationResult, type RaceSnapshot, type RogainingScore,
  type StartPunchNote } from "@o-tid/domain";
import { localRelay, relaySnapshot, type LocalRelay } from "./relay";
import type { QueuedRegistration } from "./store";

/** Det som avläsningsvyn visar direkt efter en avläsning, före serverns svar. */
export interface LocalVerdict {
  readonly status: EvaluationResult["status"];
  readonly reason: EvaluationResult["reason"];
  /** Deltagaren som brickan hör till (för kvittots länk till löparens resultat). */
  readonly entryId?: string;
  readonly name?: string;
  readonly club?: string;
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
  /** Minutstart (PLAN.md steg 25): sen eller tidig startstämpling, eller starttid från stämplingen. */
  readonly startNote?: StartPunchNote;
  /** Hyrbricka som ska samlas in (PLAN.md steg 25). */
  readonly rental?: boolean;
}

/**
 * Paketet med de direktanmälningar som gjorts i den här webbläsaren men som paketet inte känner än (PLAN.md steg 25),
 * så att avläsningen bedöms lokalt mot den nya deltagaren även utan nät. En avvisad anmälan räknas inte, och när paketet
 * redan har brickan gäller paketet (servern kan ha kopplat brickan till någon som anmälts någon annanstans).
 */
export function withLocalRegistrations(pkg: ReadoutPackage, registrations: readonly QueuedRegistration[]): ReadoutPackage {
  const snapshot = pkg.raceSnapshot;
  const known = new Set(snapshot.cardAssignments.filter((assignment) => assignment.active).map((assignment) => assignment.cardNumber));
  const classes = new Set(snapshot.classes.map((raceClass) => raceClass.id));
  const added = registrations.filter((row) => row.status !== "rejected" && !known.has(row.request.cardNumber) &&
    classes.has(row.request.classId));
  if (added.length === 0) return pkg;
  const unique = [...new Map(added.map((row) => [row.request.cardNumber, row])).values()];
  return { ...pkg, raceSnapshot: { ...snapshot,
    entries: [...snapshot.entries, ...unique.map((row) => ({ id: row.requestId, raceId: snapshot.race.id, classId: row.request.classId,
      givenName: row.request.givenName, familyName: row.request.familyName,
      ...(row.request.organisationName ? { organisationName: row.request.organisationName } : {}) }))],
    cardAssignments: [...snapshot.cardAssignments, ...unique.map((row) => ({ id: row.requestId, raceId: snapshot.race.id,
      entryId: row.requestId, cardNumber: row.request.cardNumber, active: true }))] } };
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
  const startNote = entry && raceClass && !relay ? startPunchNote({ startRule: raceClass.startRule, fixedStartTime: entry.fixedStartTime,
    startPunchedAt: payload.startPunchedAt }) : undefined;
  return {
    ...(relay ? { relay } : {}),
    status: result.status,
    reason: result.reason,
    ...(entry ? { entryId: entry.id, name: `${entry.givenName} ${entry.familyName}`.trim() } : {}),
    ...(entry?.organisationName ? { club: entry.organisationName } : {}),
    ...(raceClass ? { className: raceClass.name } : {}),
    ...(variant ? { variant } : {}),
    ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
    ...(result.rogaining ? { rogaining: result.rogaining } : {}),
    ...(startNote ? { startNote } : {}),
    ...(owner?.rental ? { rental: true } : {}),
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
