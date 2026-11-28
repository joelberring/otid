"use client";

import type { GeoJobList, MapProjectView } from "@o-tid/contracts";
import type { SourceFeature } from "@o-tid/map-revision";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { mapKnollsEn, mapPitsEn, mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapKnollsSv, mapPitsSv, mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import { clubRequest } from "../../lib/club-request";
import { mapProjectBase } from "../../lib/map-project-client";
import { inClip, stageChoices } from "../../lib/map-project-stages";
import {
  chooseKnollCandidates, cliffFeatures, cliffLimitsAt, DEFAULT_PIT_LEVEL, defaultCliffLimits, defaultKnollLimits, defaultPitLimits, knollFeatures, knollLimitsAt, pitLimitsAt, readCliffCandidates,
  readKnollCandidates, type CliffLimits, type KnollCandidate, type KnollLimits, type PitLimits
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
function SavedChoicePanel<C, L extends object>({ view, importer, file, own, initial, read, choose, heading, help, name, controls, testId, atLevel, position }: {
  /** Var en kandidat ligger (kandidaternas koordinater): med alla etapper tas varje etapps kandidater bara inom dess klippruta. */
  position: (candidate: C) => readonly [number, number];
  /** Gränserna för en mängd på skalan 1–10 (5 = förvalen); `current` är det som är finjusterat. */
  atLevel: (level: number, current: L) => L;
  view: MapProjectView; importer: Importer; file: string; own: RegExp | ((candidates: readonly C[]) => RegExp); initial: L; read: (json: unknown) => C[];
  choose: (candidates: readonly C[], limits: L) => { features: SourceFeature[]; message: string };
  heading: string; help: string; name: (job: string) => string; testId: string;
  controls: (limits: L, slider: Slider<L>, change: (patch: Partial<L>) => void) => ReactNode;
}) {
  const text = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const base = mapProjectBase(view.projectId);
  type Job = Pick<GeoJobList["jobs"][number], "jobId" | "name" | "status" | "createdAt" | "clip">;
  const [jobs, setJobs] = useState<readonly Job[]>();
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
    setJobs(list.filter(job => job.status === "DONE" && job.outputs.some(output => output.name === file))
      .map(job => ({ jobId: job.jobId, name: job.name, status: job.status, createdAt: job.createdAt, clip: job.clip })));
  }
  // En körning i etapper är ett eget val (förvalt), så att reglagen räknar hela kartan och inte en remsa i taget.
  const choices = jobs ? stageChoices(jobs) : undefined;
  const job = choices?.find(row => row.id === chosen) ?? choices?.[0];
  const label = (choice: NonNullable<typeof job>) => choice.stages ? text.allStages(choice.stages.base, choice.stages.total) : choice.jobs[0]!.name;

  async function load() {
    if (!job) return;
    setBusy(true); setMessage(undefined);
    try {
      const parts = await Promise.all(job.jobs.map(async row => {
        const response = await fetch(`${base}/geo-jobs/${row.jobId}/outputs/${file}`, { credentials: "same-origin" }).catch(() => undefined);
        const candidates = response?.ok ? read(await response.json().catch(() => undefined)) : [];
        // Etapperna går omlott: varje etapp ger bara det som ligger i dess egen ruta.
        return job.stages && row.clip ? candidates.filter(candidate => inClip(position(candidate), row.clip!)) : candidates;
      }));
      if (parts.some(part => part.length === 0)) { setMessage({ tone: "error", text: text.failed }); return; }
      setLoaded({ jobId: job.id, name: job.stages?.base ?? job.jobs[0]!.name, candidates: parts.flat() });
    } finally { setBusy(false); }
  }

  const latest = useRef<() => void>(() => undefined);
  latest.current = () => {
    if (!loaded) return;
    const result = choose(loaded.candidates, limits);
    if (result.features.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
    const ownPattern = typeof own === "function" ? own(loaded.candidates) : own;
    importer.refine(name(loaded.name), { features: result.features, skipped: 0, crs: 3006 }, ownPattern);
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
      <label>{text.job}<select value={job.id} onChange={event => { setChosen(event.target.value); setLoaded(undefined); setMessage(undefined); }}>
        {choices!.map(row => <option key={row.id} value={row.id}>{label(row)}</option>)}
      </select></label>
      {loaded?.jobId !== job.id ? <span className={styles.actions}>
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

/** Vilka lager knollreglaget ersätter: även `dotknoll`/`dotknoll_avlang` när `kullar.geojson` bär egen formklassning (`aspect`/`angle`). */
export function knollOwnPattern(candidates: readonly KnollCandidate[]): RegExp {
  return candidates.some(candidate => candidate.aspect !== undefined && candidate.angle !== undefined)
    ? /^dotknoll(_laser|_avlang)?$/i : /^dotknoll_laser$/;
}

/** Punkthöjderna (109, samt 110 när `kullar.geojson` bär `aspect`/`angle`) bland laserjobbets möjliga små kullar. */
export function MapProjectKnollPanel({ view, importer, scale }: { view: MapProjectView; importer: Importer; scale?: number | undefined }) {
  const text = useTexts(mapKnollsSv, mapKnollsEn).knolls;
  return <SavedChoicePanel<KnollCandidate, KnollLimits> view={view} importer={importer} file="kullar.geojson" own={knollOwnPattern}
    initial={defaultKnollLimits(scale)} atLevel={level => knollLimitsAt(level, scale)} position={candidate => candidate.at} read={readKnollCandidates} heading={text.heading} help={text.help} name={text.name} testId="map-project-knolls"
    choose={(candidates, limits) => { const picked = chooseKnollCandidates(candidates, limits, scale); return { features: knollFeatures(picked), message: text.done(picked.length, candidates.length) }; }}
    controls={(limits, slider) => <>
      {slider("minRise", text.minRise(limits.minRise.toLocaleString("sv-SE", { minimumFractionDigits: 1 })), 0.5, 3, 0.05)}
      {slider("lowerShare", text.lowerShare(Math.round(limits.lowerShare * 100)), 0.5, 1, 0.05)}
      {slider("maxFootM2", text.maxFoot(limits.maxFootM2), 20, 160, 1)}
      {slider("spacing", text.spacing(limits.spacing), 6, 60, 2)}
    </>} />;
}

/** Branterna (201, 202) bland laserjobbets sparade branter med mått (`brantlinjer.geojson`). `scale` ger normens kortaste brant. */
export function MapProjectCliffPanel({ view, importer, scale }: { view: MapProjectView; importer: Importer; scale: number }) {
  const text = useTexts(mapKnollsSv, mapKnollsEn).cliffs;
  const meters = (value: number) => value.toLocaleString("sv-SE", { minimumFractionDigits: 1 });
  return <SavedChoicePanel<Parameters<typeof cliffFeatures>[0][number], CliffLimits> view={view} importer={importer} file="brantlinjer.geojson" own={/^brant_/}
    initial={defaultCliffLimits(scale)} atLevel={(level, current) => cliffLimitsAt(level, current, scale)} position={candidate => candidate.line[Math.floor(candidate.line.length / 2)]!} read={readCliffCandidates} heading={text.heading} help={text.help} name={text.name} testId="map-project-cliffs"
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

/**
 * Gropar och sänkor (ägaren 2026-11-15, Grövelsjön: «mycket negativ kurvbild»): valet bland sänkorna som söktes ur markens höjd
 * när grundkartan lästes in (`importer.pits`). Reglaget byter bara sänkornas egna lager i det som visas och räknar om en kort
 * stund efter att det flyttats; ingen laserdata hämtas eller körs igen.
 */
export function MapProjectPitPanel({ importer }: { importer: Importer }) {
  const text = useTexts(mapPitsSv, mapPitsEn);
  const shared = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const pits = importer.pits;
  const [limits, setLimits] = useState<PitLimits>(pits?.limits ?? defaultPitLimits(pits?.scale));
  const [level, setLevel] = useState(pits?.level ?? DEFAULT_PIT_LEVEL);
  /** Gränserna som senast räknades, och sökningen de hör till (en ny grundkarta står på sina egna förval). */
  const ran = useRef(pits?.limits), loaded = useRef(pits?.candidates);
  useEffect(() => {
    if (!pits || pits.candidates === loaded.current) return;
    loaded.current = pits.candidates; ran.current = pits.limits;
    setLimits(pits.limits); setLevel(pits.level);
  }, [pits]);
  const choose = useRef(importer.choosePitLimits);
  choose.current = importer.choosePitLimits;
  const searched = pits?.candidates;
  useEffect(() => {
    if (!searched || searched !== loaded.current || ran.current === limits) return;
    const timer = setTimeout(() => { ran.current = limits; choose.current(limits, level); }, 200);
    return () => clearTimeout(timer);
  }, [searched, limits, level]);

  if (!importer.canImport) return null;
  const meters = (value: number) => value.toLocaleString("sv-SE", { minimumFractionDigits: 1 });
  const slider = (key: keyof PitLimits, label: string, min: number, max: number, step: number) => <label key={key}>{label}
    <input type="range" min={min} max={max} step={step} value={limits[key]} data-testid={`map-project-pits-${key}`}
      onChange={event => setLimits(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>;
  return <details className={styles.settings} data-testid="map-project-pits">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!pits ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{shared.amount(level)}
        <input type="range" min={1} max={10} step={1} value={level} data-testid="map-project-pits-amount"
          onChange={event => { const next = Number(event.target.value); setLevel(next); setLimits(pitLimitsAt(next, pits.scale)); }} /></label>
      <p className={styles.muted}>{shared.amountHelp}</p>
      <details><summary>{shared.fine}</summary>
        {slider("minDepth", text.minDepth(meters(limits.minDepth)), 0.3, 2, 0.1)}
        {slider("ringDepth", text.ringDepth(meters(limits.ringDepth)), 0.5, 3, 0.05)}
        {slider("spacing", text.spacing(limits.spacing), 10, 60, 5)}
      </details>
      <span className={styles.actions}><Button variant="quiet" onClick={() => { setLevel(DEFAULT_PIT_LEVEL); setLimits(defaultPitLimits(pits.scale)); }}>{shared.reset}</Button></span>
      <p role="status" data-testid="map-project-pits-message">{text.done(pits.points, pits.rings, pits.candidates.length)}</p>
    </>}
  </details>;
}
