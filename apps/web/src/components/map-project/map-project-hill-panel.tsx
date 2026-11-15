"use client";

import { DEFAULT_HILL_LEVEL, DEFAULT_HILL_LIMITS, hillLimitsAt, type HillLimits } from "@o-tid/map-revision/base-map";
import { useEffect, useRef, useState } from "react";
import { mapHillsEn, mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapHillsSv, mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";

type Importer = ReturnType<typeof useMapProjectImport>;

/**
 * Små höjder som ring (ägaren 2026-11-15: «färre punkthöjder och fler små höjder»): höjderna söktes ur markens höjd när
 * grundkartan lästes in (`importer.hills`). Reglaget byter bara höjdernas egna lager i det som visas, lägger tillbaka eller
 * tar bort punkthöjderna i ringarna och räknar om en kort stund efter att det släppts.
 */
export function MapProjectHillPanel({ importer }: { importer: Importer }) {
  const text = useTexts(mapHillsSv, mapHillsEn);
  const shared = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const hills = importer.hills;
  const [limits, setLimits] = useState<HillLimits>(hills?.limits ?? DEFAULT_HILL_LIMITS);
  const [level, setLevel] = useState(hills?.level ?? DEFAULT_HILL_LEVEL);
  /** Gränsen som senast räknades, och sökningen den hör till (en ny grundkarta står på sitt eget förval). */
  const ran = useRef(hills?.limits), loaded = useRef(hills?.candidates);
  useEffect(() => {
    if (!hills || hills.candidates === loaded.current) return;
    loaded.current = hills.candidates; ran.current = hills.limits;
    setLimits(hills.limits); setLevel(hills.level);
  }, [hills]);
  const choose = useRef(importer.chooseHillLimits);
  choose.current = importer.chooseHillLimits;
  const searched = hills?.candidates;
  useEffect(() => {
    if (!searched || searched !== loaded.current || ran.current === limits) return;
    const timer = setTimeout(() => { ran.current = limits; choose.current(limits, level); }, 200);
    return () => clearTimeout(timer);
  }, [searched, limits, level]);

  if (!importer.canImport) return null;
  return <details className={styles.settings} data-testid="map-project-hills">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!hills ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{shared.amount(level)}
        <input type="range" min={1} max={10} step={1} value={level} data-testid="map-project-hills-amount"
          onChange={event => { const next = Number(event.target.value); setLevel(next); setLimits(hillLimitsAt(next)); }} /></label>
      <p className={styles.muted}>{shared.amountHelp}</p>
      <details><summary>{shared.fine}</summary>
        <label>{text.ringRise(limits.ringRise.toLocaleString("sv-SE", { minimumFractionDigits: 1 }))}
          <input type="range" min={0.6} max={2.5} step={0.1} value={limits.ringRise} data-testid="map-project-hills-ringRise"
            onChange={event => setLimits({ ringRise: Number(event.target.value) })} /></label>
      </details>
      <span className={styles.actions}><Button variant="quiet" onClick={() => { setLevel(DEFAULT_HILL_LEVEL); setLimits(DEFAULT_HILL_LIMITS); }}>{shared.reset}</Button></span>
      <p role="status" data-testid="map-project-hills-message">{text.done(hills.rings, hills.contours, hills.hidden.length, hills.candidates.length)}</p>
    </>}
  </details>;
}
