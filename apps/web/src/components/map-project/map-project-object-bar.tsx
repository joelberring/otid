"use client";

import type { MapObject } from "@o-tid/map-file";
import { Button } from "../ui";
import type { useMapProjectWorkLayers } from "./use-map-project-work-layers";
import styles from "./map-project-editor.module.css";

/**
 * Statusradens knappar för det som pågår (utbrutet ur `map-project-editor.tsx`): skisslagret, utkastet (Avsluta, Avbryt) och
 * för det markerade Flytta hela (linje) och Vrid (punkt). Det som görs med det markerade står i kontextraden.
 */
export function MapProjectObjectBar(props: {
  label: string; work: ReturnType<typeof useMapProjectWorkLayers>;
  workText: { readonly textLabel: string; readonly undo: string; readonly done: string };
  tools: { readonly finish: string; readonly cancel: string; readonly moveWhole: string; readonly moveWholeHelp: string; readonly rotate: string; readonly rotateHelp: string };
  drafting: boolean; onFinish: () => void; onCancel: () => void;
  /** Det markerade objektets slag i Markera, annars inget. */
  selectedKind: MapObject["kind"] | undefined; activeVertex: boolean;
  moveWhole: boolean; onMoveWhole: (next: (value: boolean) => boolean) => void; rotating: boolean; onRotating: (next: (value: boolean) => boolean) => void;
}) {
  const { work, workText, tools, selectedKind } = props;
  if (!work.drawingLayer && !props.drafting && selectedKind !== "line" && selectedKind !== "point") return null;
  return <div className={styles.objectBar} role="group" aria-label={props.label} data-testid="map-project-object-bar">
    {work.drawingLayer && <>
      <label className={styles.inlineField}>{workText.textLabel}<input value={work.label} maxLength={200} onChange={event => work.setLabel(event.target.value)}
        data-testid="map-project-sketch-text" /></label>
      <Button variant="secondary" disabled={!work.canUndo} onClick={work.undo}>{workText.undo}</Button>
      <Button onClick={work.stop} data-testid="map-project-sketch-done">{workText.done}</Button>
    </>}
    {props.drafting && <>
      <Button onClick={props.onFinish}>{tools.finish}</Button>
      <Button variant="secondary" onClick={props.onCancel}>{tools.cancel}</Button>
    </>}
    {selectedKind === "line" && !props.activeVertex && <Button variant={props.moveWhole ? "primary" : "secondary"} aria-pressed={props.moveWhole}
      title={tools.moveWholeHelp} onClick={() => props.onMoveWhole(value => !value)} data-testid="map-project-move-whole">{tools.moveWhole}</Button>}
    {selectedKind === "point" && <Button variant={props.rotating ? "primary" : "secondary"} aria-pressed={props.rotating}
      title={tools.rotateHelp} onClick={() => props.onRotating(value => !value)}>{tools.rotate}</Button>}
  </div>;
}
