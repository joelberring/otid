import type { EntryTransferCandidates, StartListPublicationContent } from "@o-tid/contracts";
import { compareText, matches, searchable } from "./search";

/**
 * PLAN.md steg 13: en gemensam modell för startlistorna i arbetsytan och på den publika sidan.
 * Arbetsytan bygger den ur deltagarlistan (med bricka), den publika sidan ur den publicerade startlistan (utan bricka).
 * Vyerna (per klass, per starttid, per klubb), utskriften och CSV-exporten läser bara den här modellen.
 */

export type StartMode = { kind: "FREE" } | { kind: "MINUTE" } | { kind: "MASS"; time: string | null } | { kind: "RELAY"; legCount: number };
export type StartRelay = { teamNumber: number; teamName: string; teamClub: string | null; leg: number };
export type StartEntry = {
  /** Deltagarens id i arbetsytan (öppnar deltagarkortet). Saknas på den publika sidan. */
  id?: string;
  name: string; club: string | null; startTime: string | null; variant: string | null; relay?: StartRelay;
  /** Bara i arbetsytan: aktiv bricka (null = ingen) och om flera brickor är aktiva samtidigt. */
  card?: string | null; multipleCards?: boolean;
};
export type StartClass = {
  name: string; courseName: string | null; firstControlCode: number | null; mode: StartMode; entries: StartEntry[];
  /** Lediga lottade starttider. */
  vacancies: string[];
};
export type StartListModel = {
  eventName: string; raceName: string; raceDate: string; timeZone: string; classes: StartClass[];
  /** Arbetsytan visar bricka; den publika listan gör det aldrig. */
  cards: boolean;
};

function mode(raceClass: { startRule: "FIXED" | "PUNCH"; drawMethod?: "MINUTE" | "MASS" | null | undefined; relayLegCount?: number | undefined },
  times: readonly (string | null)[]): StartMode {
  if (raceClass.relayLegCount !== undefined) return { kind: "RELAY", legCount: raceClass.relayLegCount };
  if (raceClass.startRule === "PUNCH") return { kind: "FREE" };
  if (raceClass.drawMethod === "MASS") {
    const first = times.flatMap(time => time ? [time] : []).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return { kind: "MASS", time: first ?? null };
  }
  return { kind: "MINUTE" };
}

/** Lag i nummerordning och sträckor i ordning; annars starttid (utan tid sist) och namn. */
export function compareStartEntries(a: StartEntry, b: StartEntry): number {
  if (a.relay && b.relay) return a.relay.teamNumber - b.relay.teamNumber || a.relay.leg - b.relay.leg;
  const at = a.startTime ? Date.parse(a.startTime) : Infinity, bt = b.startTime ? Date.parse(b.startTime) : Infinity;
  return (at === bt ? 0 : at < bt ? -1 : 1) || compareText(a.name, b.name);
}

/** Arbetsytan: deltagarlistan som den är nu, med bricka. */
export function startListFromWorkspace(data: EntryTransferCandidates): StartListModel {
  return {
    eventName: data.eventName, raceName: data.raceName, raceDate: data.raceDate, timeZone: data.timeZone, cards: true,
    classes: data.classes.map(raceClass => {
      const entries: StartEntry[] = data.entries.filter(entry => entry.classId === raceClass.id).map(entry => ({
        id: entry.id, name: entry.displayName, club: entry.organisationName,
        startTime: raceClass.startRule === "FIXED" ? entry.fixedStartTime : null,
        variant: entry.courseVariantCode !== null && raceClass.courseVariants.includes(entry.courseVariantCode) ? entry.courseVariantCode : null,
        ...(entry.relay ? { relay: { teamNumber: entry.relay.teamNumber, teamName: entry.relay.teamName, teamClub: null, leg: entry.relay.leg } } : {}),
        card: entry.activeAssignment?.cardNumber ?? null, multipleCards: entry.multipleActiveAssignments
      })).sort(compareStartEntries);
      return { name: raceClass.name, courseName: raceClass.courseName, firstControlCode: raceClass.firstControlCode ?? null,
        mode: mode(raceClass, entries.map(entry => entry.startTime)), entries, vacancies: raceClass.vacancies ?? [] };
    })
  };
}

/** Den publika sidan: den publicerade startlistan, i serverns ordning. */
export function startListFromPublication(content: StartListPublicationContent): StartListModel {
  return {
    eventName: content.eventName, raceName: content.raceName, raceDate: content.raceDate, timeZone: content.timeZone, cards: false,
    classes: content.classes.map(raceClass => {
      const entries: StartEntry[] = raceClass.entries.map(entry => ({
        name: entry.displayName, club: entry.organisationName, startTime: entry.fixedStartTime, variant: entry.courseVariantCode ?? null,
        ...(entry.relay ? { relay: { teamNumber: entry.relay.teamNumber, teamName: entry.relay.teamName,
          teamClub: entry.relay.teamOrganisationName, leg: entry.relay.leg } } : {})
      }));
      const relayLegCount = raceClass.relayLegCount ?? (entries.some(entry => entry.relay)
        ? Math.max(...entries.map(entry => entry.relay?.leg ?? 1)) : undefined);
      return { name: raceClass.name, courseName: raceClass.courseName ?? null, firstControlCode: raceClass.firstControlCode ?? null,
        mode: mode({ ...raceClass, relayLegCount }, entries.map(entry => entry.startTime)), entries, vacancies: raceClass.vacancies ?? [] };
    })
  };
}

/**
 * Sök och klassfilter. Sökningen gäller namn, klubb, lag och bricka; klasser utan träffar och vakanser
 * döljs när man söker. Utan sökning visas även tomma klasser.
 */
export function filterStartList(classes: readonly StartClass[], query: string, className: string): StartClass[] {
  const needle = searchable(query.trim());
  return classes.filter(row => !className || row.name === className).flatMap(row => {
    if (!needle) return [row];
    const entries = row.entries.filter(entry => matches(needle, entry.name, entry.club, entry.card, entry.relay?.teamName, entry.relay?.teamClub));
    return entries.length ? [{ ...row, entries, vacancies: [] }] : [];
  });
}

export type StartClassRow = { time: string | null; entry: StartEntry | null };

/** Klassens rader i startordning: löparna och de vakanta tiderna insorterade efter tid. */
export function classStartRows(raceClass: StartClass): StartClassRow[] {
  const rows: StartClassRow[] = [...raceClass.entries.map(entry => ({ time: entry.startTime, entry })),
    ...raceClass.vacancies.map(time => ({ time, entry: null }))];
  return rows.sort((a, b) => a.entry && b.entry ? compareStartEntries(a.entry, b.entry)
    : (a.time ? Date.parse(a.time) : Infinity) - (b.time ? Date.parse(b.time) : Infinity) || Number(a.entry === null) - Number(b.entry === null));
}

/** Klubben som en rad räknas till: löparens egen, annars lagets. */
export const startClub = (entry: StartEntry) => entry.club ?? entry.relay?.teamClub ?? null;

/** En rad i listan per starttid. `entry` null = vakant tid. */
export type StartTimeRow = { className: string; time: string; entry: StartEntry | null };
export type StartMinute = { minute: number; rows: StartTimeRow[] };
export type StartPlace = { firstControlCode: number | null; minutes: StartMinute[] };
export type StartTimeGroups = {
  /** En grupp per startfålla (första kontroll). En enda grupp när alla startar från samma ställe. */
  places: StartPlace[];
  /** Klasser med fri start (löparna stämplar start). */
  free: StartClass[];
  /** Löpare som borde ha en tid men saknar den (stafettens senare sträckor räknas inte). */
  missing: { className: string; entry: StartEntry }[];
};

/** Startlistan minut för minut, per startfålla, med vakanta tider (för startfunktionärer). */
export function groupByStartTime(classes: readonly StartClass[]): StartTimeGroups {
  const places = new Map<string, { firstControlCode: number | null; rows: StartTimeRow[] }>();
  const free: StartClass[] = [], missing: StartTimeGroups["missing"] = [];
  for (const raceClass of classes) {
    if (raceClass.mode.kind === "FREE") { free.push(raceClass); continue; }
    const code = raceClass.mode.kind === "RELAY" ? null : raceClass.firstControlCode;
    const key = String(code);
    const place = places.get(key) ?? { firstControlCode: code, rows: [] };
    for (const entry of raceClass.entries) {
      if (entry.startTime) place.rows.push({ className: raceClass.name, time: entry.startTime, entry });
      else if (!entry.relay || entry.relay.leg === 1) missing.push({ className: raceClass.name, entry });
    }
    for (const time of raceClass.vacancies) place.rows.push({ className: raceClass.name, time, entry: null });
    places.set(key, place);
  }
  const ordered = [...places.values()].filter(place => place.rows.length > 0)
    .sort((a, b) => (a.firstControlCode ?? Infinity) - (b.firstControlCode ?? Infinity));
  return {
    free, missing,
    places: ordered.map(place => {
      const minutes = new Map<number, StartTimeRow[]>();
      for (const row of place.rows) {
        const minute = Math.floor(Date.parse(row.time) / 60_000) * 60_000;
        minutes.set(minute, [...(minutes.get(minute) ?? []), row]);
      }
      return { firstControlCode: place.firstControlCode, minutes: [...minutes.entries()].sort(([a], [b]) => a - b).map(([minute, rows]) => ({
        minute, rows: rows.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || compareText(a.className, b.className) ||
          Number(a.entry === null) - Number(b.entry === null) || compareText(a.entry?.name ?? "", b.entry?.name ?? ""))
      })) };
    })
  };
}

export type ClubGroup<Row> = { club: string | null; rows: Row[] };

/** Grupperar rader per klubb i bokstavsordning; utan klubb sist. Radernas inbördes ordning behålls. */
export function groupByClub<Row>(rows: readonly Row[], clubOf: (row: Row) => string | null): ClubGroup<Row>[] {
  const groups = new Map<string | null, Row[]>();
  for (const row of rows) {
    const club = clubOf(row)?.trim() || null;
    groups.set(club, [...(groups.get(club) ?? []), row]);
  }
  return [...groups.entries()].map(([club, items]) => ({ club, rows: items }))
    .sort((a, b) => a.club === null ? 1 : b.club === null ? -1 : compareText(a.club, b.club));
}

/** Startlistan per klubb: klubbens löpare i klassordning och starttid. */
export function startListByClub(classes: readonly StartClass[]): ClubGroup<{ className: string; entry: StartEntry }>[] {
  return groupByClub(classes.flatMap(raceClass => raceClass.entries.map(entry => ({ className: raceClass.name, entry }))),
    row => startClub(row.entry));
}
