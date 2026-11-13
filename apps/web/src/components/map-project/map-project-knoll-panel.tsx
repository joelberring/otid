"use client";

import type { GeoJobList, MapProjectView } from "@o-tid/contracts";
import type { SourceFeature } from "@o-tid/map-revision";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { mapKnollsEn, mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapKnollsSv, mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import {
  chooseKnolls, cliffFeatures, cliffLimitsAt, DEFAULT_KNOLL_LIMITS, defaultCliffLimits, knollFeatures, knollLimitsAt, readCliffCandidates, readKnollCandidates,
  type CliffLimits, type KnollLimits
} from "@o-tid/map-revision/base-map";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";

type Importer = ReturnType<typeof useMapProjectImport>;
type Slider<L> = (key: keyof L & string, label: string, min: number, max: number, step: number) => ReactNode;

/**
 * Ägaren 2026-11-12 («om man vill få färre punkthöjder … måste väl inte allt köras om»): ett val bland det laserjobbet har
 * sparat med sina mått (`file`), med reglage. Kandidaterna räknas om en kort stund efter att ett reglage flyttats, utan att
 * laserdatan hämtas eller körs igen. Bara panelens egna lager (`own`) byts i det som visas; grundkartan i övrigt står kvar.
 */
function SavedChoicePanel<C, L extends object>({ view, importer, file, own, initial, read, choose, heading, help, name, controls, testId, atLevel }: {
  /** Gränserna för en mängd på skalan 1–10 (5 = förvalen); `current` är det som är finjusterat. */
  atLevel: (level: number, current: L) => L;
  view: MapProjectView; importer: Importer; file: string; own: RegExp; initial: L; read: (json: unknown) => C[];
  choose: (candidates: readonly C[], limits: L) => { features: SourceFeature[]; message: string };
  heading: string; help: string; name: (job: string) => string; testId: string;
  controls: (limits: L, slider: Slider<L>, change: (patch: Partial<L>) => void) => ReactNode;
}) {
  const text = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const base = mapProjectBase(view.projectId);
  const [jobs, setJobs] = useState<readonly { jobId: string; name: string }[]>();
  const [chosen, setChosen] = useState("");
  const [loaded, setLoaded] = useState<{ jobId: string; name: string; candidates: readonly C[] }>();
  const [limits, setLimits] = useState<L>(initial);
  const [level, setLevel] = useState(5);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  async function open() {
    if (jobs) return;
    const result = await clubRequest(`${base}/geo-jobs`).catch(() => ({ status: 0, json: undefined }));
    const list = result.status === 200 ? (result.json as GeoJobList).jobs : [];
    setJobs(list.filter(job => job.status === "DONE" && job.outputs.some(output => output.name === file)).map(job => ({ jobId: job.jobId, name: job.name })));
  }
  const job = jobs?.find(row => row.jobId === chosen) ?? jobs?.[0];

  async function load() {
    if (!job) return;
    setBusy(true); setMessage(undefined);
    try {
      const response = await fetch(`${base}/geo-jobs/${job.jobId}/outputs/${file}`, { credentials: "same-origin" }).catch(() => undefined);
      const candidates = response?.ok ? read(await response.json().catch(() => undefined)) : [];
      if (candidates.length === 0) { setMessage({ tone: "error", text: text.failed }); return; }
      setLoaded({ jobId: job.jobId, name: job.name, candidates });
    } finally { setBusy(false); }
  }

  const latest = useRef<() => void>(() => undefined);
  latest.current = () => {
    if (!loaded) return;
    const result = choose(loaded.candidates, limits);
    if (result.features.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
    importer.refine(name(loaded.name), { features: result.features, skipped: 0, crs: 3006 }, own);
    setMessage({ tone: "ok", text: result.message });
  };
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => latest.current(), 200);
    return () => clearTimeout(timer);
  }, [loaded, limits]);

  if (!importer.canImport) return null;
  const change = (patch: Partial<L>) => setLimits(current => ({ ...current, ...patch }));
  const slider: Slider<L> = (key, label, min, max, step) => <label key={key}>{label}
    <input type="range" min={min} max={max} step={step} value={Number(limits[key])} data-testid={`${testId}-${key}`}
      onChange={event => change({ [key]: Number(event.target.value) } as Partial<L>)} /></label>;
  return <details className={styles.settings} data-testid={testId} onToggle={event => { if (event.currentTarget.open) void open(); }}>
    <summary>{heading}</summary>
    <p className={styles.muted}>{help}</p>
    {jobs && jobs.length === 0 && <p className={styles.muted}>{text.none}</p>}
    {job && <>
      <label>{text.job}<select value={job.jobId} onChange={event => { setChosen(event.target.value); setLoaded(undefined); setMessage(undefined); }}>
        {jobs!.map(row => <option key={row.jobId} value={row.jobId}>{row.name}</option>)}
      </select></label>
      {loaded?.jobId !== job.jobId ? <span className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => void load()} data-testid={`${testId}-load`}>{busy ? text.loading : text.load}</Button>
      </span> : <>
        {/* Ägaren 2026-11-12: en skala 1–10 med förvalet i mitten; de enskilda gränserna finns under Finjustera. */}
        <label>{text.amount(level)}
          <input type="range" min={1} max={10} step={1} value={level} data-testid={`${testId}-amount`}
            onChange={event => { const next = Number(event.target.value); setLevel(next); setLimits(current => atLevel(next, current)); }} /></label>
        <p className={styles.muted}>{text.amountHelp}</p>
        <details><summary>{text.fine}</summary>{controls(limits, slider, change)}</details>
        <span className={styles.actions}><Button variant="quiet" onClick={() => { setLevel(5); setLimits(initial); }}>{text.reset}</Button></span>
      </>}
    </>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid={`${testId}-message`}>{message.text}</p>}
  </details>;
}

/** Punkthöjderna (109) bland laserjobbets möjliga små kullar (`kullar.geojson`). */
export function MapProjectKnollPanel({ view, importer }: { view: MapProjectView; importer: Importer }) {
  const text = useTexts(mapKnollsSv, mapKnollsEn).knolls;
  return <SavedChoicePanel<Parameters<typeof chooseKnolls>[0][number], KnollLimits> view={view} importer={importer} file="kullar.geojson" own={/^dotknoll_laser$/}
    initial={DEFAULT_KNOLL_LIMITS} atLevel={knollLimitsAt} read={readKnollCandidates} heading={text.heading} help={text.help} name={text.name} testId="map-project-knolls"
    choose={(candidates, limits) => { const points = chooseKnolls(candidates, limits); return { features: knollFeatures(points), message: text.done(points.length, candidates.length) }; }}
    controls={(limits, slider) => <>
      {slider("minRise", text.minRise(limits.minRise.toLocaleString("sv-SE", { minimumFractionDigits: 1 })), 0.5, 3, 0.1)}
      {slider("lowerShare", text.lowerShare(Math.round(limits.lowerShare * 100)), 0.5, 1, 0.05)}
      {slider("maxFootM2", text.maxFoot(limits.maxFootM2), 20, 160, 10)}
      {slider("spacing", text.spacing(limits.spacing), 10, 60, 5)}
    </>} />;
}

/** Branterna (201, 202) bland laserjobbets sparade branter med mått (`brantlinjer.geojson`). `scale` ger normens kortaste brant. */
export function MapProjectCliffPanel({ view, importer, scale }: { view: MapProjectView; importer: Importer; scale: number }) {
  const text = useTexts(mapKnollsSv, mapKnollsEn).cliffs;
  const meters = (value: number) => value.toLocaleString("sv-SE", { minimumFractionDigits: 1 });
  return <SavedChoicePanel<Parameters<typeof cliffFeatures>[0][number], CliffLimits> view={view} importer={importer} file="brantlinjer.geojson" own={/^brant_/}
    initial={defaultCliffLimits(scale)} atLevel={(level, current) => cliffLimitsAt(level, current, scale)} read={readCliffCandidates} heading={text.heading} help={text.help} name={text.name} testId="map-project-cliffs"
    choose={(candidates, limits) => { const result = cliffFeatures(candidates, limits); return { features: result.features, message: text.done(result.impassable, result.passable, candidates.length) }; }}
    controls={(limits, slider, change) => <>
      {slider("minDrop", text.minDrop(meters(limits.minDrop)), 0.8, 6, 0.1)}
      {slider("minLength", text.minLength(meters(limits.minLength)), 0, 40, 1)}
      {slider("impassableDrop", text.impassableDrop(meters(limits.impassableDrop)), 2, 8, 0.5)}
      {slider("impassableLength", text.impassableLength(limits.impassableLength), 6, 40, 2)}
      <label className={styles.check}><input type="checkbox" checked={limits.tags} data-testid="map-project-cliffs-tags"
        onChange={event => change({ tags: event.target.checked })} /> {text.tags}</label>
    </>} />;
}
