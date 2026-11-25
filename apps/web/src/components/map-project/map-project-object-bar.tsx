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
  /** Styrpunkter för markerad streckad linje. */
  dash?: {
    readonly selectedDashed: boolean; readonly activeVertexDash: boolean; readonly mode: boolean; readonly busy: boolean;
    readonly onToggleVertex: () => void; readonly onToggleMode: () => void; readonly onAuto: () => void;
    readonly labels: { readonly toggleVertex: string; readonly toggleVertexHelp: string; readonly modeButton: string; readonly modeHelp: string; readonly autoButton: string; readonly autoHelp: string };
  } | undefined;
}) {
  const { work, workText, tools, selectedKind, dash } = props;
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
    {selectedKind === "line" && dash?.selectedDashed && <>
      {props.activeVertex && <Button variant={dash.activeVertexDash ? "primary" : "secondary"} aria-pressed={dash.activeVertexDash}
        title={dash.labels.toggleVertexHelp} onClick={dash.onToggleVertex} data-testid="map-project-object-dash-vertex">{dash.labels.toggleVertex}</Button>}
      <Button variant={dash.mode ? "primary" : "secondary"} aria-pressed={dash.mode}
        title={dash.labels.modeHelp} onClick={dash.onToggleMode} data-testid="map-project-object-dash-mode">{dash.labels.modeButton}</Button>
      <Button variant="secondary" disabled={dash.busy}
        title={dash.labels.autoHelp} onClick={dash.onAuto} data-testid="map-project-object-dash-auto">{dash.labels.autoButton}</Button>
    </>}
    {selectedKind === "point" && <Button variant={props.rotating ? "primary" : "secondary"} aria-pressed={props.rotating}
      title={tools.rotateHelp} onClick={() => props.onRotating(value => !value)}>{tools.rotate}</Button>}
  </div>;
}
