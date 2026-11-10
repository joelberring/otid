"use client";

import { useRef, useState } from "react";
import type { MapGeoreference } from "@o-tid/map-file";
import { mapProjectIntakeEn } from "../../i18n/map-project-intake-en";
import { mapProjectIntakeSv } from "../../i18n/map-project-intake-sv";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { mapProjectBase } from "../../lib/map-project-client";
import { sortIntake, vectorSketches, type IntakeDecision, type IntakeGroup, type IntakeReason } from "../../lib/map-project-folder-intake";
import { readVectorFiles } from "../../lib/map-project-vector-files";
import { useLocale, useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectLayers } from "./use-map-project-layers";
import type { useMapProjectWorkLayers } from "./use-map-project-work-layers";
import styles from "./map-project-editor.module.css";

const BATCH = 500;
type Outcome = { tone: "ok" | "error"; text: string };

/**
 * Ägaren 2026-11-10: en mapp med blandat underlag från äldre kartprojekt. Filerna sorteras här i webbläsaren (`sortIntake`);
 * vektorer blir skisslager (ett per fil, skisserna i omgångar om 500), bilder blir underlag (med världsfil på sin plats, annars
 * mitt i kartan för passpunkter) och resten laddas aldrig upp. Listan kan ändras innan något läggs in.
 */
export function MapProjectFolderIntake({ projectId, georeference, bounds, layers, work }: {
  projectId: string; georeference: MapGeoreference | undefined; bounds: Bounds | undefined;
  layers: ReturnType<typeof useMapProjectLayers>; work: ReturnType<typeof useMapProjectWorkLayers>;
}) {
  const text = useTexts(mapProjectIntakeSv, mapProjectIntakeEn);
  const locale = useLocale();
  const folder = useRef<HTMLInputElement>(null), files = useRef<HTMLInputElement>(null);
  const [groups, setGroups] = useState<IntakeGroup[]>();
  const [sorting, setSorting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const [summary, setSummary] = useState<string>();
  const mapEpsg = georeference?.crs.kind === "EPSG" ? georeference.crs.code : undefined;
  const size = (bytes: number) => bytes >= 1e6 ? `${(bytes / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
    : `${Math.ceil(bytes / 1e3).toLocaleString(locale)} kB`;

  async function choose(list: FileList | null) {
    if (!list || list.length === 0) return;
    setSorting(true); setSummary(undefined); setOutcomes(new Map());
    try { setGroups(await sortIntake([...list])); } finally { setSorting(false); }
  }

  const decide = (key: string, decision: IntakeDecision) =>
    setGroups(current => current?.map(row => row.key === key ? { ...row, decision, reason: decision === "DISCARD" ? row.reason ?? "OTHER" : undefined } : row));

  async function addVector(group: IntakeGroup): Promise<Outcome> {
    if (!georeference || !bounds) return { tone: "error", text: text.reasons.NO_CRS };
    const read = await readVectorFiles(group.files).catch(() => undefined);
    if (!read) return { tone: "error", text: text.reasons.EMPTY };
    const result = vectorSketches(read.data, georeference, bounds, mapEpsg);
    if ("problem" in result) return { tone: "error", text: text.reasons[result.problem as IntakeReason] };
    const layer = await work.createLayer("SKETCH", group.stem.slice(0, 80), []);
    if (!layer) return { tone: "error", text: text.failed };
    for (let start = 0; start < result.sketches.length; start += BATCH) {
      const response = await clubRequest(`${mapProjectBase(projectId)}/sketches`, "POST", { formatVersion: 1, layerId: layer.layerId,
        sketches: result.sketches.slice(start, start + BATCH).map(sketch => ({ sketchId: crypto.randomUUID(), ...sketch })) }).catch(() => undefined);
      if (response?.status !== 201) return { tone: "error", text: text.failed };
    }
    return { tone: "ok", text: text.sketched(result.sketches.length) };
  }

  async function start() {
    const chosen = (groups ?? []).filter(row => row.decision !== "DISCARD");
    let sketches = 0, underlag = 0;
    const next = new Map<string, Outcome>();
    for (const [index, group] of chosen.entries()) {
      setProgress({ done: index, total: chosen.length });
      let outcome: Outcome;
      if (group.decision === "SKETCH") outcome = await addVector(group);
      else outcome = await layers.upload(group.files, group.stem.slice(0, 80), mapEpsg, bounds) ? { tone: "ok", text: text.decision.UNDERLAG }
        : { tone: "error", text: text.failed };
      if (outcome.tone === "ok") { if (group.decision === "SKETCH") sketches += 1; else underlag += 1; }
      next.set(group.key, outcome);
      setOutcomes(new Map(next));
    }
    setProgress(undefined);
    await work.reload();
    setSummary(text.done(sketches, underlag));
  }

  const keep = groups?.filter(row => row.decision !== "DISCARD") ?? [];
  const discard = groups?.filter(row => row.decision === "DISCARD") ?? [];
  return <details className={styles.settings} data-testid="map-project-intake">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!georeference && <p className={styles.muted}>{text.noGeoreference}</p>}
    <span className={styles.actions}>
      <Button variant="secondary" disabled={sorting || !!progress} onClick={() => folder.current?.click()}>{text.chooseFolder}</Button>
      <Button variant="quiet" disabled={sorting || !!progress} onClick={() => files.current?.click()}>{text.chooseFiles}</Button>
      {groups && <Button variant="quiet" disabled={!!progress} onClick={() => { setGroups(undefined); setSummary(undefined); }}>{text.cancel}</Button>}
    </span>
    {/* webkitdirectory: hela mappen med undermappar (Chrome, Edge, Firefox och Safari). */}
    <input ref={folder} type="file" hidden multiple {...{ webkitdirectory: "" }} data-testid="map-project-intake-folder"
      onChange={event => { void choose(event.target.files); event.target.value = ""; }} />
    <input ref={files} type="file" hidden multiple data-testid="map-project-intake-files"
      onChange={event => { void choose(event.target.files); event.target.value = ""; }} />
    {sorting && <p role="status">{text.sorting}</p>}
    {groups && <>
      <p className={styles.muted} data-testid="map-project-intake-summary">
        {text.summary(keep.length, discard.length, size(discard.reduce((sum, row) => sum + row.bytes, 0)))}</p>
      <ul className={styles.rows} data-testid="map-project-intake-list">
        {groups.map(group => <li key={group.key} data-decision={group.decision}>
          <span><strong>{group.name}</strong> <small className={styles.muted}>{size(group.bytes)}
            {group.decision === "DISCARD" && group.reason ? ` · ${text.reasons[group.reason]}` : ""}
            {outcomes.get(group.key) ? ` · ${outcomes.get(group.key)!.text}` : ""}</small></span>
          <select value={group.decision} aria-label={text.decisionLabel(group.name)} disabled={!!progress}
            onChange={event => decide(group.key, event.target.value as IntakeDecision)}>
            {(group.kind === "VECTOR" ? ["SKETCH", "DISCARD"] : group.kind === "IMAGE" ? ["UNDERLAG", "DISCARD"] : ["DISCARD"] as const)
              .map(option => <option key={option} value={option}>{text.decision[option as IntakeDecision]}</option>)}
          </select>
        </li>)}
      </ul>
      <span className={styles.actions}>
        <Button disabled={keep.length === 0 || !!progress || !!summary} onClick={() => void start()} data-testid="map-project-intake-start">
          {text.start(keep.length)}</Button>
      </span>
    </>}
    {progress && <p role="status">{text.working(progress.done + 1, progress.total)}</p>}
    {summary && <p role="status" data-testid="map-project-intake-done">{summary}</p>}
  </details>;
}
