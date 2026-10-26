import { entryCourseControls } from "./course-variants";
import { teamSprintChangeovers } from "./relay-parallel";
import { prepareReadoutForEvaluation } from "./station-corrections";
import type { EvaluationReadout, Punch, RaceSnapshot } from "./types";

/**
 * Steg 50 (ADR-0174 beslut 9): teamsprint med utläsning efter varje sträcka, som MeOS. Rena funktioner.
 *
 * Löparen stämplar mål och läser ut efter varje sträcka utan att tömma brickan. Den andra utläsningen har då kvar första
 * sträckans stämplingar och en ny måltid (SPORTident sparar bara den senaste målstämplingen). Varje utläsning går till
 * löparens första sträcka som ännu saknar resultat och bedöms mot stämplingarna efter föregående utläsnings mål.
 *
 * Glömd utläsning: en utläsning kan täcka flera av löparens sträckor. Det syns på växlingsstämplingarna när klassen har en
 * växlingskontroll (delningen blir som vid utläsning efter sista sträckan), annars på att sträckornas banor kan läggas i
 * tur och ordning på stämplingarna. Utan växlingskontroll finns ingen måltid för de tidigare sträckorna: bara den sista
 * får ett resultat, och de andra visas som "Utläsning efter sträcka X saknas" tills en funktionär sätter manuell tid.
 */
export type TeamSprintReadoutMode = "EACH_LEG" | "LAST_LEG";

/** Löparens sträcka i en klass med utläsning efter varje sträcka, med utläsningen den bygger på. */
export interface TeamSprintEachLegPart {
  readonly mode: "EACH_LEG";
  /** Sträckans nummer bland löparens sträckor (1 = löparens första). */
  readonly part: number;
  readonly parts: number;
  /** Löparens sträcklöpare i ordning (för banorna när en utläsning täcker flera sträckor). */
  readonly legEntryIds: readonly string[];
  /** Utläsningen täcker löparens sträckor `from`–`to`; normalt bara den här (`from` = `to` = `part`). */
  readonly from: number;
  readonly to: number;
  /** Föregående utläsnings mål: stämplingar till och med den hör till tidigare sträckor. */
  readonly after?: string;
  /** Klassens växlingskontroll, om den har en. */
  readonly changeoverCode?: number;
}

const DOUBLE_PUNCH_MS = 60_000;

function ms(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Stämplingarna efter föregående utläsnings mål, utan växlingskontrollen. */
function segmentPunches(readout: EvaluationReadout, after: number | undefined, changeoverCode: number | undefined): Punch[] {
  return readout.punches.filter((punch) => {
    const time = ms(punch.punchedAt);
    return time !== undefined && (after === undefined || time > after) && punch.code !== changeoverCode;
  });
}

/** Växlingsstämplingarna i utläsningen efter `after` och mer än en minut före målet (stämplad växling, sedan mål). */
function segmentChangeovers(readout: EvaluationReadout, after: number | undefined, changeoverCode: number): string[] {
  const finish = ms(readout.finishPunchedAt);
  return teamSprintChangeovers(readout, changeoverCode).filter((time) => {
    const at = Date.parse(time);
    return (after === undefined || at > after) && (finish === undefined || at < finish - DOUBLE_PUNCH_MS);
  });
}

/**
 * Var stämplingarna delas mellan banorna i tur och ordning: index efter sista stämplingen som fullbordar bana i (för alla
 * utom den sista banan). Slutar när en bana inte fullbordas.
 */
export function teamSprintCourseCuts(punches: readonly Punch[], courses: readonly (readonly number[])[]): number[] {
  const cuts: number[] = [];
  let position = 0;
  for (let index = 0; index < courses.length - 1; index += 1) {
    let next = position;
    let complete = true;
    for (const code of courses[index]!) {
      while (next < punches.length && punches[next]!.code !== code) next += 1;
      if (next >= punches.length) { complete = false; break; }
      next += 1;
    }
    if (!complete || courses[index]!.length === 0) break;
    cuts.push(next);
    position = next;
  }
  return cuts;
}

/** Hur många av banans kontroller som finns i tur och ordning bland stämplingarna. */
function matchedInOrder(punches: readonly Punch[], course: readonly number[]): number {
  let next = 0, matched = 0;
  for (const code of course) {
    let at = next;
    while (at < punches.length && punches[at]!.code !== code) at += 1;
    if (at >= punches.length) continue;
    matched += 1;
    next = at + 1;
  }
  return matched;
}

/**
 * Hur många av sträckorna (`courses`, i tur och ordning från den första som saknar utläsning) som utläsningen täcker.
 * Banorna: en bana är lagd när den fullbordats och nästa bana till minst hälften (och minst två kontroller) finns i
 * stämplingarna efter. Växlingsstämplingarna: en sträcka per växling. Det största av de två gäller.
 */
export function teamSprintCoverage(readout: EvaluationReadout, input: { readonly after?: string; readonly changeoverCode?: number;
  readonly courses: readonly (readonly number[])[] }): { readonly count: number; readonly byChangeover: boolean } {
  const after = ms(input.after);
  const punches = segmentPunches(readout, after, input.changeoverCode);
  const cuts = teamSprintCourseCuts(punches, input.courses);
  let byCourse = 1;
  for (let index = 0; index < cuts.length; index += 1) {
    const rest = punches.slice(cuts[index], cuts[index + 1] ?? punches.length);
    const course = input.courses[index + 1]!;
    const needed = course.length < 2 ? course.length : Math.max(2, Math.ceil(course.length / 2));
    if (needed === 0 || matchedInOrder(rest, course) < needed) break;
    byCourse = index + 2;
  }
  const byCode = input.changeoverCode === undefined ? 1 : 1 + segmentChangeovers(readout, after, input.changeoverCode).length;
  const count = Math.min(input.courses.length, Math.max(byCourse, byCode));
  return { count, byChangeover: input.changeoverCode !== undefined && count > 1 && byCode >= count };
}

/** Banornas kontrollkoder för löparens sträckor `from`–`to`. */
function coursesOf(snapshot: RaceSnapshot, part: TeamSprintEachLegPart): (readonly number[])[] {
  return part.legEntryIds.slice(part.from - 1, part.to).map((entryId) => entryCourseControls(snapshot, entryId)?.controlCodes ?? []);
}

/** Föregående utläsnings mål med tävlingens tidsjustering för målet, som brickans egna tider. */
function preparedAfter(snapshot: RaceSnapshot, cardNumber: string, after: string | undefined): number | undefined {
  if (after === undefined) return undefined;
  return ms(prepareReadoutForEvaluation({ cardNumber, finishPunchedAt: after, punches: [] }, snapshot).readout.finishPunchedAt);
}

/**
 * Sträckans del av utläsningen: stämplingarna efter föregående utläsnings mål och brickans mål. Täcker utläsningen flera
 * sträckor delas den vid växlingsstämplingarna (mål vid växlingen) eller vid banorna (bara den sista sträckan har ett mål).
 * Sträckans start är alltid sträckans egen (föregående sträckas växling i laget), aldrig brickans startstämpling.
 */
export function teamSprintEachLegReadout(readout: EvaluationReadout, part: TeamSprintEachLegPart, snapshot: RaceSnapshot): EvaluationReadout {
  const after = preparedAfter(snapshot, readout.cardNumber, part.after);
  const base = { cardNumber: readout.cardNumber, ...(readout.readAt !== undefined ? { readAt: readout.readAt } : {}),
    ...(readout.checkPunchedAt !== undefined ? { checkPunchedAt: readout.checkPunchedAt } : {}),
    ...(readout.clearPunchedAt !== undefined ? { clearPunchedAt: readout.clearPunchedAt } : {}) };
  const finish = readout.finishPunchedAt;
  const index = part.part - part.from;
  const last = part.part === part.to;
  if (part.from === part.to) {
    return { ...base, punches: segmentPunches(readout, after, part.changeoverCode), ...(finish !== undefined ? { finishPunchedAt: finish } : {}) };
  }
  if (part.changeoverCode !== undefined) {
    const changeovers = segmentChangeovers(readout, after, part.changeoverCode);
    if (changeovers.length >= part.to - part.from) {
      const from = index === 0 ? after : Date.parse(changeovers[index - 1]!);
      const end = last ? finish : changeovers[index];
      const to = ms(end);
      const punches = segmentPunches(readout, from, part.changeoverCode).filter((punch) => to === undefined || Date.parse(punch.punchedAt) <= to);
      return { ...base, punches, ...(end !== undefined ? { finishPunchedAt: end } : {}) };
    }
  }
  const punches = segmentPunches(readout, after, part.changeoverCode);
  const cuts = teamSprintCourseCuts(punches, coursesOf(snapshot, part));
  const start = index === 0 ? 0 : cuts[index - 1] ?? punches.length;
  const end = last ? punches.length : cuts[index] ?? punches.length;
  return { ...base, punches: punches.slice(start, end), ...(last && finish !== undefined ? { finishPunchedAt: finish } : {}) };
}

/** En av löparens sträckor när en ny utläsning ska fördelas. */
export interface TeamSprintRoutePart {
  readonly entryId: string;
  readonly leg: number;
  /** Sträckan har ett resultat (från en utläsning eller ett beslut). */
  readonly done: boolean;
  /** Utläsningen som sträckans resultat bygger på. */
  readonly readout?: { readonly id: string; readonly finishPunchedAt?: string };
  /** Sträckans banas kontrollkoder. */
  readonly controlCodes: readonly number[];
}

export type TeamSprintRoute =
  /** Sträckorna `from`–`to` (index i löparens sträckor, 1-baserat). `missing`: sträckor utan mål (glömd utläsning). */
  | { readonly kind: "LEGS"; readonly from: number; readonly to: number; readonly byChangeover: boolean; readonly missing: readonly number[] }
  /** Samma bricka utläst igen efter samma sträcka: en omläsning av sträckorna som den tidigare utläsningen täckte. */
  | { readonly kind: "REREAD"; readonly readoutId: string; readonly parts: readonly number[] }
  /** Måltiden är tidigare än föregående sträckas (index `part`). */
  | { readonly kind: "EARLIER_FINISH"; readonly part: number }
  /** Löparen har resultat på alla sina sträckor. */
  | { readonly kind: "ALL_READ" };

/**
 * Vilken av löparens sträckor en ny utläsning gäller: den första som ännu saknar resultat, och de följande som samma
 * utläsning täcker (glömd utläsning) fram till nästa sträcka som redan har en utläsning.
 */
export function teamSprintRoute(parts: readonly TeamSprintRoutePart[], readout: EvaluationReadout,
  changeoverCode?: number): TeamSprintRoute {
  const finish = ms(readout.finishPunchedAt);
  for (let index = 0; index < parts.length; index += 1) {
    const earlier = parts[index]!.readout;
    if (!earlier || finish === undefined || ms(earlier.finishPunchedAt) !== finish) continue;
    const covered = parts.flatMap((part, position) => part.readout?.id === earlier.id ? [position + 1] : []);
    return { kind: "REREAD", readoutId: earlier.id, parts: covered };
  }
  const first = parts.findIndex((part) => !part.done);
  if (first < 0) return { kind: "ALL_READ" };
  const previous = [...parts.slice(0, first)].reverse().find((part) => part.readout?.finishPunchedAt !== undefined);
  const previousFinish = ms(previous?.readout?.finishPunchedAt);
  if (finish !== undefined && previousFinish !== undefined && finish < previousFinish) {
    return { kind: "EARLIER_FINISH", part: parts.indexOf(previous!) + 1 };
  }
  const nextDone = parts.findIndex((part, index) => index > first && part.done);
  const candidates = parts.slice(first, nextDone < 0 ? parts.length : nextDone);
  const coverage = teamSprintCoverage(readout, { ...(previous?.readout?.finishPunchedAt ? { after: previous.readout.finishPunchedAt } : {}),
    ...(changeoverCode !== undefined ? { changeoverCode } : {}), courses: candidates.map((part) => part.controlCodes) });
  const from = first + 1, to = first + coverage.count;
  const missing = coverage.count > 1 && !coverage.byChangeover ? Array.from({ length: coverage.count - 1 }, (_, index) => from + index) : [];
  return { kind: "LEGS", from, to, byChangeover: coverage.byChangeover, missing };
}

/** En av löparens sträckor i ögonblicksbilden: utläsningen som sträckans resultat bygger på. */
export interface TeamSprintLayoutPart {
  readonly entryId: string;
  readonly readout?: { readonly id: string; readonly finishPunchedAt?: string };
}

/**
 * Sträckornas del i löparens utläsningar (för bedömningen): en sträcka med utläsning täcker sig själv, de tidigare sträckorna
 * utan utläsning närmast före (glömd utläsning) och de närmast följande med samma utläsning (delad vid växlingarna).
 */
export function teamSprintEachLegLayout(parts: readonly TeamSprintLayoutPart[], changeoverCode?: number): Map<string, TeamSprintEachLegPart> {
  const legEntryIds = parts.map((part) => part.entryId);
  const result = new Map<string, TeamSprintEachLegPart>();
  parts.forEach((part, index) => {
    const own = part.readout;
    let from = index;
    if (own) {
      while (from > 0 && (!parts[from - 1]!.readout || parts[from - 1]!.readout!.id === own.id)) from -= 1;
    }
    let to = index;
    if (own) while (to + 1 < parts.length && parts[to + 1]!.readout?.id === own.id) to += 1;
    const before = own ? [...parts.slice(0, from)].reverse().find((candidate) => candidate.readout?.finishPunchedAt !== undefined) : undefined;
    const previous = !own ? [...parts.slice(0, index)].reverse().find((candidate) => candidate.readout?.finishPunchedAt !== undefined) : before;
    result.set(part.entryId, { mode: "EACH_LEG", part: index + 1, parts: parts.length, legEntryIds,
      from: own ? from + 1 : index + 1, to: own ? to + 1 : index + 1,
      ...(previous?.readout?.finishPunchedAt ? { after: previous.readout.finishPunchedAt } : {}),
      ...(changeoverCode !== undefined ? { changeoverCode } : {}) });
  });
  return result;
}

/** Sträckor (index) utan resultat där en senare sträcka för samma löpare har en utläsning: utläsningen efter dem saknas. */
export function teamSprintMissingReadouts(parts: readonly { readonly done: boolean; readonly hasReadout: boolean }[]): number[] {
  const lastRead = parts.map((part) => part.hasReadout).lastIndexOf(true);
  return parts.flatMap((part, index) => !part.done && index < lastRead ? [index + 1] : []);
}
