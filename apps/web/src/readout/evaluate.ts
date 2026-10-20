import type { ReadoutPackage, SportidentReadoutPayload } from "@o-tid/contracts";
import { cardPunchList, courseVariantForReadout, evaluateCardReadout, prepareReadoutForEvaluation, startPunchNote, type CardPunchList, type EvaluationResult,
  type RaceSnapshot, type RogainingScore, type StartPunchNote } from "@o-tid/domain";
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
  /** Felstämplad eller okänd bricka (PLAN.md steg 27): alla stämplingar på brickan mot banan och tävlingsdagen. */
  readonly punchList?: CardPunchList;
  /** Oröjd bricka (PLAN.md steg 31): gamla stämplingar som inte räknades, även när resultatet är godkänt. */
  readonly ignoredPunches?: number;
  /**
   * Steg 31 (B4): brickan har redan lästs ut för deltagaren. `certain`: en tidigare avläsning i den här webbläsaren har
   * andra stämplingar; annars har deltagaren ett resultat enligt paketet (kan vara samma bricka läst på en annan dator,
   * serverns svar avgör).
   */
  readonly alreadyReadOutBy?: { readonly entryId: string; readonly classId: string; readonly name: string; readonly className: string;
    readonly certain: boolean };
}

/** Har brickan använts i ett nytt lopp (start- eller kontrollstämpling) efter den förra avläsningens mål? */
export function laterRunThan(previous: Pick<SportidentReadoutPayload, "startPunchedAt" | "finishPunchedAt" | "punches">,
  next: Pick<SportidentReadoutPayload, "startPunchedAt" | "punches">): boolean {
  const times = [previous.finishPunchedAt, previous.startPunchedAt, ...previous.punches.map((punch) => punch.punchedAt)]
    .flatMap((value) => value === undefined ? [] : [Date.parse(value)]).filter(Number.isFinite);
  const end = previous.finishPunchedAt !== undefined ? Date.parse(previous.finishPunchedAt) : Math.max(...times);
  if (!Number.isFinite(end)) return false;
  return (next.startPunchedAt !== undefined && Date.parse(next.startPunchedAt) > end) ||
    next.punches.some((punch) => Date.parse(punch.punchedAt) > end);
}

/** Samma bricka, start, mål och stämplingar. */
export function samePayloadContent(left: Pick<SportidentReadoutPayload, "cardNumber" | "startPunchedAt" | "finishPunchedAt" | "punches">,
  right: Pick<SportidentReadoutPayload, "cardNumber" | "startPunchedAt" | "finishPunchedAt" | "punches">): boolean {
  const ms = (value: string | undefined) => value === undefined ? null : Date.parse(value);
  return left.cardNumber === right.cardNumber && ms(left.startPunchedAt) === ms(right.startPunchedAt) &&
    ms(left.finishPunchedAt) === ms(right.finishPunchedAt) && left.punches.length === right.punches.length &&
    left.punches.every((punch, index) => punch.code === right.punches[index]!.code &&
      Date.parse(punch.punchedAt) === Date.parse(right.punches[index]!.punchedAt));
}

/**
 * Paketet med de direktanmälningar och kopplingar som gjorts i den här webbläsaren men som paketet inte känner än (PLAN.md
 * steg 25 och 29), så att avläsningen bedöms lokalt mot den nya eller valda deltagaren även utan nät. En avvisad anmälan
 * räknas inte, och när paketet redan har brickan gäller paketet (servern kan ha kopplat brickan till någon som anmälts
 * någon annanstans). En koppling släpper deltagarens tidigare bricka, som på servern.
 */
export function withLocalRegistrations(pkg: ReadoutPackage, registrations: readonly QueuedRegistration[]): ReadoutPackage {
  const snapshot = pkg.raceSnapshot;
  const known = new Set(snapshot.cardAssignments.filter((assignment) => assignment.active).map((assignment) => assignment.cardNumber));
  const classes = new Set(snapshot.classes.map((raceClass) => raceClass.id));
  const entries = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const added = new Map<string, QueuedRegistration>();
  for (const row of registrations) {
    // Steg 31 (B4): en lånad bricka flyttas till den nya eller valda deltagaren även om paketet redan känner brickan.
    if (row.status === "rejected" || (known.has(row.request.cardNumber) && !row.request.borrowedCard) ||
      added.has(row.request.cardNumber)) continue;
    const request = row.request;
    if ("target" in request ? entries.get(request.entryId)?.classId === request.expectedClassId : classes.has(request.classId)) {
      added.set(request.cardNumber, row);
    }
  }
  if (added.size === 0) return pkg;
  const rows = [...added.values()];
  const linkedEntries = new Set(rows.flatMap((row) => "target" in row.request ? [row.request.entryId] : []));
  const newEntries = rows.flatMap((row) => "target" in row.request ? [] : [{ id: row.requestId, raceId: snapshot.race.id,
    classId: row.request.classId, givenName: row.request.givenName, familyName: row.request.familyName,
    ...(row.request.organisationName ? { organisationName: row.request.organisationName } : {}) }]);
  return { ...pkg, raceSnapshot: { ...snapshot,
    entries: [...snapshot.entries, ...newEntries],
    cardAssignments: [...snapshot.cardAssignments.map((assignment) => assignment.active && (linkedEntries.has(assignment.entryId) ||
      added.has(assignment.cardNumber)) ? { ...assignment, active: false } : assignment),
    ...rows.map((row) => ({ id: row.requestId, raceId: snapshot.race.id, cardNumber: row.request.cardNumber, active: true,
      entryId: "target" in row.request ? row.request.entryId : row.requestId }))] } };
}

/**
 * Bedömer avläsningen lokalt mot det senast hämtade paketet med samma
 * resultatmotor som servern. Serverns svar är det som gäller. `local` är tidigare
 * avläsningar i den här webbläsaren: en stafettsträckas start är föregående sträckas mål.
 */
export function evaluateLocally(payload: SportidentReadoutPayload, pkg: ReadoutPackage,
  local: readonly SportidentReadoutPayload[] = [], readAt?: string): LocalVerdict {
  // Lästid (när avläsningen togs emot), check och clear: gamla stämplingar på en oröjd bricka räknas inte (PLAN.md steg 31),
  // som på servern.
  const readout = {
    cardNumber: payload.cardNumber,
    ...(payload.startPunchedAt ? { startPunchedAt: payload.startPunchedAt } : {}),
    ...(payload.finishPunchedAt ? { finishPunchedAt: payload.finishPunchedAt } : {}),
    ...(payload.checkPunchedAt ? { checkPunchedAt: payload.checkPunchedAt } : {}),
    ...(payload.clearPunchedAt ? { clearPunchedAt: payload.clearPunchedAt } : {}),
    ...(readAt ? { readAt } : {}),
    punches: payload.punches
  };
  const owner = pkg.raceSnapshot.cardAssignments.find((assignment) => assignment.active && assignment.cardNumber === payload.cardNumber);
  const earlier = local.filter((candidate) => candidate !== payload);
  const sameCard = earlier.filter((candidate) => candidate.cardNumber === payload.cardNumber);
  const ownerEntry = owner ? pkg.raceSnapshot.entries.find((candidate) => candidate.id === owner.entryId) : undefined;
  // Samma regel som servern: brickan har använts i ett nytt lopp efter förra avläsningens mål.
  const differsLocally = sameCard.some((candidate) => !samePayloadContent(candidate, payload) && laterRunThan(candidate, payload));
  const readOutByOwner = owner !== undefined && (pkg.readOutEntryIds ?? []).includes(owner.entryId) && sameCard.length === 0;
  const alreadyReadOutBy = ownerEntry && (differsLocally || readOutByOwner) ? { entryId: ownerEntry.id, classId: ownerEntry.classId,
    name: `${ownerEntry.givenName} ${ownerEntry.familyName}`.trim(),
    className: pkg.raceSnapshot.classes.find((candidate) => candidate.id === ownerEntry.classId)?.name ?? "", certain: differsLocally }
    : undefined;
  // Kontraktets valfria fält tillåter uttryckligt undefined; resultatmotorn läser dem inte.
  const snapshot = owner ? relaySnapshot(pkg, owner.entryId, earlier) : pkg.raceSnapshot as RaceSnapshot;
  const result = evaluateCardReadout(readout, snapshot);
  const variant = result.entryId ? courseVariantForReadout(readout, snapshot) : undefined;
  const entry = result.entryId ? pkg.raceSnapshot.entries.find((candidate) => candidate.id === result.entryId) : undefined;
  const raceClass = result.classId ? pkg.raceSnapshot.classes.find((candidate) => candidate.id === result.classId) : undefined;
  const relay = result.entryId && result.status !== "UNKNOWN_CARD" ? localRelay(pkg, result.entryId, { status: result.status,
    ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}) }, earlier) : undefined;
  const punchList = result.status === "MP" || result.status === "UNKNOWN_CARD"
    ? cardPunchList(readout, snapshot, result.entryId, pkg.event.timeZone) : undefined;
  const ignoredPunches = prepareReadoutForEvaluation(readout, snapshot).ignoredPunches;
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
    ...(punchList ? { punchList } : {}),
    ...(ignoredPunches > 0 ? { ignoredPunches } : {}),
    ...(alreadyReadOutBy ? { alreadyReadOutBy } : {}),
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
