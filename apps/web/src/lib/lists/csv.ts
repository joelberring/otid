import { formatClockTime, formatDuration } from "../clock-time";
import { listsSv as text } from "../../i18n/lists-sv";
import { classStartRows, groupByStartTime, startClub, startListByClub, type StartClass, type StartMode } from "./start-list-model";
import { resultsByClub, splitGroups, type ResultListModel, type ResultRow, type ResultStatus } from "./result-list-model";

/**
 * CSV för Excel (PLAN.md steg 13): UTF-8 med BOM så att å, ä och ö visas rätt, semikolon som avskiljare
 * (svensk Excel), radbrytning CRLF och svenska rubriker. Fält med semikolon, citattecken eller radbrytning
 * citeras. Text som börjar med = + - @ får en apostrof först så att Excel inte tolkar den som en formel.
 */
export const CSV_BOM = "﻿";
export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let cell = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, "\"\"")}"` : cell;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + [header, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

const duration = (ms: number | null) => ms === null ? "" : formatDuration(ms);
const status = (value: ResultStatus) => text.results.status[value];

function modeText(mode: StartMode): string {
  return mode.kind === "FREE" ? text.csv.free : mode.kind === "MASS" ? text.csv.mass : mode.kind === "RELAY" ? text.csv.relay : text.csv.minute;
}

export type StartView = "CLASS" | "TIME" | "CLUB";
export type ResultView = "CLASS" | "SPLITS" | "CLUB";

/** Startlistan i vald vy. Bricka tas bara med när modellen har bricka (arbetsytan). */
export function startListCsv(view: StartView, classes: readonly StartClass[], timeZone: string, cards: boolean): string {
  const clock = (instant: string | null) => instant ? formatClockTime(instant, timeZone) : "";
  const withoutCard = <T,>(header: readonly T[], cardIndex: number) => cards ? [...header] : header.filter((_, index) => index !== cardIndex);
  const card = (value: string | null | undefined, multiple?: boolean) => multiple ? text.start.multipleCards : value ?? "";
  if (view === "TIME") {
    const groups = groupByStartTime(classes);
    const rows = groups.places.flatMap(place => place.minutes.flatMap(minute => minute.rows.map(row => withoutCard([
      clock(row.time), place.firstControlCode ?? "", row.className, row.entry?.name ?? text.csv.vacant, row.entry ? startClub(row.entry) : "",
      row.entry ? card(row.entry.card, row.entry.multipleCards) : ""], 5))));
    return toCsv(withoutCard(text.csv.start.TIME, 5), rows);
  }
  if (view === "CLUB") {
    const rows = startListByClub(classes).flatMap(group => group.rows.map(({ className, entry }) => withoutCard([
      group.club ?? "", entry.name, className, clock(entry.startTime), card(entry.card, entry.multipleCards)], 4)));
    return toCsv(withoutCard(text.csv.start.CLUB, 4), rows);
  }
  const rows = classes.flatMap(raceClass => classStartRows(raceClass).map(({ time, entry }) => withoutCard([raceClass.name,
    raceClass.courseName ?? "", modeText(raceClass.mode), clock(time), entry?.name ?? text.csv.vacant, entry ? startClub(entry) : "",
    entry ? card(entry.card, entry.multipleCards) : "", entry?.variant ?? "",
    entry?.relay ? `${entry.relay.teamNumber} ${entry.relay.teamName}` : "", entry?.relay?.leg ?? ""], 6)));
  return toCsv(withoutCard(text.csv.start.CLASS, 6), rows);
}

/**
 * Resultatlistan i vald vy. Stafettklasser ger en rad per lag och en per sträcklöpare. Rogainingklasser (ADR-0170
 * beslut 5) får poäng, straff och summa; "med sträcktider" blir de räknade kontrollerna när alla klasser är rogaining.
 */
export function resultListCsv(view: ResultView, model: ResultListModel): string {
  const scored = model.classes.some(raceClass => raceClass.scored);
  const score = (result: ResultRow): CsvCell[] => result.score ? [result.score.controlPoints, result.score.penalty, result.score.total] : ["", "", ""];
  if (view === "SPLITS" && scored && model.classes.every(raceClass => raceClass.scored) && model.relayClasses.length === 0) {
    const rows = model.classes.flatMap(raceClass => raceClass.rows.flatMap(result => {
      const times = new Map(result.splits.map(split => [split.controlCode, split.elapsedMs]));
      const runner = [raceClass.name, result.place ?? "", result.name, result.club ?? "", result.score?.total ?? "", duration(result.timeMs),
        status(result.status)];
      const controls = result.score?.controls ?? [];
      return controls.length === 0 ? [[...runner, "", "", ""]] : controls.map(control => [...runner, control.controlCode, control.points,
        times.has(control.controlCode) ? formatDuration(times.get(control.controlCode)!) : ""]);
    }));
    return toCsv(text.csv.results.SCORED_CONTROLS, rows);
  }
  if (view === "SPLITS") {
    const rows = model.classes.flatMap(raceClass => splitGroups(raceClass).flatMap(group => group.rows.flatMap((result, index) =>
      group.table.columns.flatMap((column, columnIndex) => {
        const cell = group.table.rows[index]!.cells[columnIndex];
        return [[raceClass.name, group.variant ?? "", result.place ?? "", result.name, result.club ?? "", duration(result.timeMs), status(result.status),
          column.kind === "FINISH" ? text.csv.finish : column.occurrence > 1 ? `${column.controlCode} (${column.occurrence})` : column.controlCode,
          cell?.legMs != null ? formatDuration(cell.legMs) : "", cell?.place ?? "", cell ? formatDuration(cell.elapsedMs) : ""]];
      }))));
    return toCsv(text.csv.results.SPLITS, rows);
  }
  if (view === "CLUB") {
    const rows = resultsByClub(model).flatMap(group => [
      ...group.runners.map(({ className, result }) => [group.club ?? "", result.name, "", className, result.place ?? "",
        duration(result.timeMs), status(result.status), ...(scored ? [result.score?.total ?? ""] : [])]),
      ...group.teams.map(({ className, team }) => [group.club ?? "", "", `${team.number} ${team.name}`, className, team.position ?? "",
        duration(team.elapsedMs), text.results.teamStatus[team.status], ...(scored ? [""] : [])])
    ]);
    return toCsv([...text.csv.results.CLUB, ...(scored ? [text.results.total] : [])], rows);
  }
  const relay = model.relayClasses.length > 0;
  const pick = (row: CsvCell[]) => relay ? row : row.filter((_, index) => index !== 2 && index !== 3);
  const rows = [
    ...model.classes.flatMap(raceClass => raceClass.rows.map(result => [...pick([raceClass.name, result.place ?? "", "", "", result.name,
      result.club ?? "", duration(result.timeMs), duration(result.behindMs), status(result.status)]), ...(scored ? score(result) : [])])),
    ...model.relayClasses.flatMap(raceClass => raceClass.teams.flatMap(team => [
      [raceClass.name, team.position ?? "", `${team.number} ${team.name}`, "", "", team.organisationName ?? "", duration(team.elapsedMs),
        duration(team.timeBehindMs), text.results.teamStatus[team.status], ...(scored ? ["", "", ""] : [])],
      ...team.legs.map(leg => [raceClass.name, leg.legPosition ?? "", `${team.number} ${team.name}`, leg.leg, `${leg.givenName} ${leg.familyName}`,
        leg.organisationName ?? "", duration(leg.elapsedMs), "", leg.status ? status(leg.status) : "", ...(scored ? ["", "", ""] : [])])
    ]))
  ];
  return toCsv([...pick([...text.csv.results.CLASS]) as string[], ...(scored ? text.csv.results.SCORE : [])], rows);
}
