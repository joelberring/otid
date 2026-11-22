"use client";

import type { GeoJobView } from "@o-tid/contracts";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { useLanguage, useTexts } from "../language-provider";
import styles from "./map-project-editor.module.css";

/**
 * PLAN.md M6 (ägaren 2026-11-22): rutan «Spara även rå laserdata åt mig» före körningen, med en rad om Lantmäteriets villkor.
 * Är förrådet av förklarar raden varför rutan inte finns.
 */
export function MapProjectRawLaserChoice({ available, checked, onChange }: { available: boolean; checked: boolean; onChange: (value: boolean) => void }) {
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  if (!available) return <small className={styles.muted} data-testid="map-project-laser-raw-off">{text.rawLaserOff}</small>;
  return <>
    <label className={styles.check}><input type="checkbox" checked={checked} data-testid="map-project-laser-raw"
      onChange={event => onChange(event.target.checked)} />{text.rawLaser}</label>
    <small className={styles.muted}>{text.rawLaserHelp} {text.rawLaserTerms}</small>
  </>;
}

/** Zip-filerna med rå laserdata i en körning: länken (bara för den som startade den), hur länge den gäller, eller felet. */
export function MapProjectRawLaserLinks({ job }: { job: GeoJobView }) {
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser), language = useLanguage();
  const files = job.rawLaser ?? [];
  if (files.length === 0) {
    return job.rawLaserRequested && (job.status === "DONE" || job.status === "FAILED")
      ? <span className={styles.muted} data-testid="map-project-laser-raw-missing"> · {text.rawLaserMissing}</span> : null;
  }
  const format = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Stockholm" });
  return <span data-testid="map-project-laser-raw-links">{files.map((file, index) => <span key={`${file.fileName}-${index}`} className={file.status === "FAILED" ? styles.problem : styles.muted}>
    {" · "}{text.rawLaserStatus[file.status]}
    {file.status === "FAILED" && file.error ? `: ${file.error}` : ""}
    {file.status === "READY" && (file.url
      ? <> <a href={file.url} rel="noreferrer" download={file.fileName} data-testid="map-project-laser-raw-link">
        {text.rawLaserLink(Math.max(1, Math.round((file.byteSize ?? 0) / (1024 * 1024))))}</a></>
      : <> ({text.rawLaserOthers})</>)}
    {file.status === "READY" && <> ({text.rawLaserUntil(format.format(new Date(file.expiresAt)))})</>}
  </span>)}
    {files.some(file => file.status === "READY") && <small className={styles.muted}> {text.rawLaserTerms}</small>}
  </span>;
}
