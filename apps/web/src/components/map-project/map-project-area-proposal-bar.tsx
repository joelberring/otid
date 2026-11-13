"use client";

import { FACE_MIN_AREA_M2 } from "@o-tid/map-revision";
import { mapProjectFillEn } from "../../i18n/map-project-fill-en";
import { mapProjectFillSv } from "../../i18n/map-project-fill-sv";
import { FILL_GAP_M } from "../../lib/map-project-fill-area";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectAreaProposals } from "./use-map-project-area-proposals";
import styles from "./map-project-candidate-bar.module.css";

/**
 * Ägaren 2026-11-13: raden för Föreslå ytor, under kartan när verktyget Fyll yta är valt på en sprintkarta. Knappen tar fram
 * kandidatytorna i det som syns på skärmen; sedan står hur många som hittades, vad färgerna betyder, och knapparna för att
 * lägga in alla med förslag eller rensa överlägget.
 */
export function MapProjectAreaProposalBar({ proposals }: { proposals: ReturnType<typeof useMapProjectAreaProposals> }) {
  const text = useTexts(mapProjectFillSv, mapProjectFillEn).propose;
  if (!proposals.available) return null;
  const count = proposals.candidates.length;
  return <section className={styles.bar} aria-label={text.barLabel} data-testid="map-project-area-proposals">
    <Button variant={count ? "secondary" : "primary"} disabled={proposals.busy} title={text.runHelp(FACE_MIN_AREA_M2, FILL_GAP_M)} onClick={proposals.run}
      data-testid="map-project-area-proposals-run">{count ? text.runAgain : text.run}</Button>
    <span className={styles.layers} role="status">
      {proposals.busy && <small className={styles.muted}>{text.busy}</small>}
      {!proposals.busy && proposals.message && <small data-testid="map-project-area-proposals-message">{proposals.message}</small>}
      {!proposals.busy && count > 0 && <>
        <strong data-testid="map-project-area-proposals-summary">{text.summary(count, proposals.suggested, proposals.uncertain)}</strong>
        {proposals.found && proposals.found.found > count && <small>{text.truncated(count, proposals.found.found)}</small>}
        <small className={styles.muted}>{text.legend}</small>
      </>}
    </span>
    {count > 0 && proposals.chosen && <label className={styles.layer} data-on={proposals.override || undefined}>
      <input type="checkbox" checked={proposals.override} onChange={() => proposals.setOverride(!proposals.override)} data-testid="map-project-area-proposals-override" />
      {text.override(proposals.chosen.code)}
    </label>}
    {count > 0 && <span className={styles.actions}>
      <Button disabled={proposals.suggested === 0 || proposals.busy} onClick={proposals.acceptAll} data-testid="map-project-area-proposals-accept">
        {text.acceptAll(proposals.suggested)}</Button>
      <Button variant="quiet" onClick={proposals.clear} data-testid="map-project-area-proposals-clear">{text.clear}</Button>
    </span>}
  </section>;
}
