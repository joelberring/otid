"use client";

import type { MapBackPage } from "@o-tid/domain";
import { mapBundlesSv as text } from "../../i18n/map-bundles-sv";
import styles from "./map-bundles.module.css";

/** Pappersformatet för baksidorna (steg 61). Webbläsarens utskrift i 100 % skala. */
export type BackPaper = "A4" | "A3";
export type BackOrientation = "portrait" | "landscape";
export type BackPosition = "TOP_LEFT" | "TOP_RIGHT" | "CENTER" | "BOTTOM_LEFT" | "BOTTOM_RIGHT";
export interface BackSettings { paper: BackPaper; orientation: BackOrientation; position: BackPosition; mirror: boolean }
export const DEFAULT_BACK_SETTINGS: BackSettings = { paper: "A4", orientation: "portrait", position: "TOP_LEFT", mirror: true };

const SIZES: Record<BackPaper, { width: number; height: number }> = { A4: { width: 210, height: 297 }, A3: { width: 297, height: 420 } };

export function sheetSize(settings: BackSettings): { width: number; height: number } {
  const size = SIZES[settings.paper];
  return settings.orientation === "portrait" ? size : { width: size.height, height: size.width };
}

/** CSS för @page: formatet och inga marginaler (sidan har egen luft). */
export function backPageCss(settings: BackSettings): string {
  const { width, height } = sheetSize(settings);
  return `@page { size: ${width}mm ${height}mm; margin: 0; }`;
}

/**
 * Speglat för baksida: en karta som vänds kring den långa sidan får vänster och höger ombytta, så texten bakom kartans
 * övre vänstra hörn hamnar uppe till höger på baksidan.
 */
export function printedPosition(settings: BackSettings): BackPosition {
  if (!settings.mirror) return settings.position;
  const swap: Record<BackPosition, BackPosition> = { TOP_LEFT: "TOP_RIGHT", TOP_RIGHT: "TOP_LEFT", BOTTOM_LEFT: "BOTTOM_RIGHT",
    BOTTOM_RIGHT: "BOTTOM_LEFT", CENTER: "CENTER" };
  return swap[settings.position];
}

export function BackSheet({ page, settings, clock }: { page: MapBackPage | "TEST"; settings: BackSettings; clock: (instant: string | null) => string }) {
  const { width, height } = sheetSize(settings);
  const position = printedPosition(settings);
  const content = page === "TEST" ? <span className={styles.labelName}>{text.testPageText}</span>
    : page.kind === "DIVIDER" ? <>
      <span className={styles.labelName}>{text.divider(page.variantCode, page.printCount)}</span>
      <span className={styles.labelLine}>{page.courseName}</span>
      <span className={styles.labelLine}>{text.dividerHelp(page.variantCode)}</span>
    </> : page.kind === "RUNNER" ? <>
      {page.variantCode && <span className={styles.bigCode}>{page.variantCode}</span>}
      <span className={styles.bigNumber}>{page.item.number}</span>
      <span className={styles.labelName}>{page.item.name}</span>
      {page.item.club && <span className={styles.labelLine}>{page.item.club}</span>}
      <span className={styles.labelLine}>{page.item.className} · {page.item.startTime ? clock(page.item.startTime) : text.freeStart}</span>
    </> : page.kind === "VACANT" ? <>
      {page.variantCode && <span className={styles.bigCode}>{page.variantCode}</span>}
      <span className={styles.bigNumber}>{page.item.number}</span>
      <span className={styles.labelLine}>{page.item.className} · {text.vacantPage(clock(page.item.startTime))}</span>
    </> : <>
      {page.variantCode && <span className={styles.bigCode}>{page.variantCode}</span>}
      <span className={styles.labelName}>{text.reservePage(page.variantCode)}</span>
      <span className={styles.labelLine}>{page.courseName}</span>
    </>;
  return <section className={`${styles.sheet} ${page !== "TEST" && page.kind === "DIVIDER" ? styles.divider : ""}`}
    style={{ width: `${width}mm`, height: `${height}mm` }} data-testid="map-back-page"
    data-kind={page === "TEST" ? "TEST" : page.kind}>
    <div className={styles.label} data-position={position}>{content}</div>
  </section>;
}
