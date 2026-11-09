import type { MapBackPage } from "@o-tid/domain";
import { mapBundlesSv } from "../i18n/map-bundles-sv";
import type { Texts } from "./language";

/**
 * Ägaren 2026-11-09: Kartor till startens baksidor följer baksidan som den är inställd i banläggningen (ADR-0213), med
 * samma variabler som där.
 */
/** Banläggningens baksida (ADR-0213): texterna uppifrån med löparens variabler. */
export type RunnerBackTexts = readonly { readonly text: string; readonly sizeMm: number; readonly bold: boolean; readonly align: "left" | "center" | "right" }[];

/** Variablerna för en sida (som i banläggningens baksida); okända blir tomma. */
export function backValues(page: Exclude<MapBackPage, { kind: "DIVIDER" }>, clock: (instant: string | null) => string,
  text: Pick<Texts<typeof mapBundlesSv>, "vacantName" | "reserveName" | "freeStart"> = mapBundlesSv): Record<string, string> {
  const runner = page.kind === "RUNNER" ? page.item : undefined;
  const name = runner ? runner.name : page.kind === "VACANT" ? text.vacantName : text.reserveName;
  return { variant: page.variantCode ?? "", bana: page.courseName, startnummer: page.kind === "RESERVE" ? "" : String(page.item.number),
    namn: name, "löpare": name, klubb: runner?.club ?? "", klass: page.kind === "RESERVE" ? "" : page.item.className,
    starttid: page.kind === "RESERVE" ? "" : page.item.startTime ? clock(page.item.startTime) : text.freeStart,
    lag: runner?.team?.name ?? "", lagnummer: runner?.team ? String(runner.team.number) : "", "sträcka": runner?.leg !== undefined ? String(runner.leg) : "" };
}

/** Raderna med variablerna ifyllda; en rad som bara hade variabler och blev tom står inte. */
export function backLines(texts: RunnerBackTexts, values: Record<string, string>) {
  return texts.flatMap(item => item.text.split("\n").map(line => ({ ...item,
    line: line.replace(/\{([a-zåäö]+)\}/gi, (_, key: string) => values[key.toLowerCase()] ?? "").replace(/ {2,}/g, "  ").trim() })))
    .filter(item => item.line !== "");
}

