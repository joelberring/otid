"use client";

import { mapPrimaryEn } from "../../i18n/map-primary-en";
import { mapPrimarySv } from "../../i18n/map-primary-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import barStyles from "./map-project-candidate-bar.module.css";
import styles from "./map-project-editor.module.css";

type Import = ReturnType<typeof useMapProjectImport>;

/** K4c: kryssrutan «Huvudkälla» för vektorfilen som visas (förval på för Stockholms baskarta). */
export function MapProjectPrimaryCheck({ importer, className }: { importer: Import; className?: string | undefined }) {
  const text = useTexts(mapPrimarySv, mapPrimaryEn);
  if (!importer.primaryEligible) return null;
  return <label className={className ?? styles.check} data-on={importer.primaryOn || undefined} title={text.checkHelp}>
    <input type="checkbox" checked={importer.primaryOn} onChange={() => importer.setPrimaryOn(!importer.primaryOn)} data-testid="map-project-primary-check" />
    {text.check}
  </label>;
}

/** K4c: projektets huvudkällor under Grundkarta, med knappen som tar bort markeringen och beskedet om det senaste. */
export function MapProjectPrimarySources({ importer }: { importer: Import }) {
  const text = useTexts(mapPrimarySv, mapPrimaryEn);
  const { primary } = importer;
  const kinds = (list: readonly (keyof typeof text.kinds)[]) => text.list(list.map(kind => text.kinds[kind]));
  const saved = primary.told && "name" in primary.told;
  if (primary.sources.length === 0 && !saved) return null;
  return <div data-testid="map-project-primary-sources">
    {saved && <PrimaryTold importer={importer} />}
    {primary.sources.map(source => <p key={source.sourceId} className={styles.muted} data-testid="map-project-primary-source">
      {text.source(source.name, kinds(source.kinds))}{" "}
      {primary.canMark && <>
        <Button variant="quiet" onClick={() => void primary.ask(source.name, source.kinds, source.area)} disabled={primary.searching}>{text.find}</Button>{" "}
        <Button variant="quiet" title={text.removeHelp} onClick={() => void primary.remove(source.sourceId)} data-testid="map-project-primary-remove">{text.remove}</Button>
      </>}
    </p>)}
  </div>;
}

function PrimaryTold({ importer }: { importer: Import }) {
  const text = useTexts(mapPrimarySv, mapPrimaryEn);
  const { told } = importer.primary;
  if (!told) return null;
  const message = "name" in told ? (told.kind === "saved" ? text.saved(told.name) : told.kind === "noKinds" ? text.noKinds(told.name) : text.failed)
    : `${told.kind === "removed" ? text.removed(told.count) : text.none}${told.kept > 0 ? text.kept(told.kept) : ""}`;
  return <p role={told.kind === "failed" ? "alert" : "status"} data-testid="map-project-primary-told">{message}{" "}
    <Button variant="quiet" onClick={importer.primary.clearTold}>OK</Button></p>;
}

/** K4c: frågan om OpenStreetMaps objekt inom huvudkällan, i raden under kartan (objekten är markerade på kartan). */
export function MapProjectPrimaryQuestion({ importer }: { importer: Import }) {
  const text = useTexts(mapPrimarySv, mapPrimaryEn);
  const { question, searching, told } = importer.primary;
  if (!question && !searching && !(told && !("name" in told))) return null;
  return <section className={barStyles.bar} aria-label={text.check} data-testid="map-project-primary-question">
    {searching && <small role="status" className={barStyles.muted}>{text.searching}</small>}
    {!question && !searching && <PrimaryTold importer={importer} />}
    {question && <>
      <strong className={barStyles.title}>{text.question(text.list(question.kinds.map(kind => text.kinds[kind])), question.changes.length)}</strong>
      <small className={barStyles.muted}>{text.questionHelp}{question.kept > 0 ? text.kept(question.kept) : ""}</small>
      <span className={barStyles.actions}>
        <Button onClick={importer.primary.confirm} data-testid="map-project-primary-yes">{text.yes}</Button>
        <Button variant="quiet" onClick={importer.primary.dismiss} data-testid="map-project-primary-no">{text.no}</Button>
      </span>
    </>}
  </section>;
}
