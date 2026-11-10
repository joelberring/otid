"use client";

import { useMemo } from "react";
import { mapNorthFacts, type MapGeoreference } from "@o-tid/map-file";
import { mapProjectNorthEn } from "../../i18n/map-project-north-en";
import { mapProjectNorthSv } from "../../i18n/map-project-north-sv";
import { useTexts } from "../language-provider";
import styles from "./map-project-editor.module.css";
import { swedishToday } from "@o-tid/domain";

const today = () => swedishToday(new Date());

/**
 * ADR-0223: kartans nordlinjer jämförda med dagens magnetiska nord i referenspunkten (World Magnetic Model 2025). Visar hur
 * mycket en äldre karta pekar fel; omriktningen är nästa steg.
 */
export function MapProjectNorthPanel({ georeference }: { georeference: MapGeoreference }) {
  const text = useTexts(mapProjectNorthSv, mapProjectNorthEn);
  const date = today();
  const facts = useMemo(() => {
    try { return mapNorthFacts(georeference, date); } catch { return null; }
  }, [georeference, date]);
  return <details className={styles.settings} data-testid="map-project-north">
    <summary>{text.heading}</summary>
    {!facts ? <p>{text.noGeoreference}</p> : <>
      <p>{text.map(facts.mapDeclination)}</p>
      <p>{text.today(facts.magnetic.degrees, date)}</p>
      <p><strong>{text.difference(facts.difference)}</strong></p>
      {!facts.magnetic.valid && <p>{text.invalid}</p>}
      <p>{text.later}</p>
    </>}
  </details>;
}
