/**
 * CSV för Excel (PLAN.md steg 13): UTF-8 med BOM så att å, ä och ö visas rätt, semikolon som avskiljare (svensk Excel),
 * radbrytning CRLF. Fält med semikolon, citattecken eller radbrytning citeras. Text som börjar med = + - @, tab eller
 * vagnretur får en apostrof först så att Excel inte tolkar den som en formel. Alla CSV-filer i O-Tid går genom de här.
 */
export const CSV_BOM = "﻿";
export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let cell = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, "\"\"")}"` : cell;
}

/** Hela filen: BOM, rubrikraden och raderna. */
export function toCsv(header: readonly CsvCell[], rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + [header, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
