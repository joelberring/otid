"use client";

import type { GeoJobList, MapProjectView } from "@o-tid/contracts";
import {
  DEFAULT_CLEAR, formlineLimitsAt, heightFieldFrom, heightGridOf, ringLimitAt, smoothLimitsAt, worldFileAffine,
  type ClearSettings, type HeightField, type PixelAffine
} from "@o-tid/map-revision/base-map";
import { useEffect, useRef, useState } from "react";
import { mapClearContoursEn, mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapClearContoursSv, mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { bitmapPixels, layerAffine } from "../../lib/map-project-flat-contours";
import { stageChoices } from "../../lib/map-project-stages";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";

const number = (value: number) => value.toLocaleString("sv-SE");
const CONTOURS = /^(contour(_index)?|formline)$/i;
const HEIGHT_IMAGE = "hojd.png", HEIGHT_WORLD = "hojd.pgw", JOB_CRS = 3006;

/**
 * Ägaren 2026-11-14 («bygg sen olika reglage … medvetna generaliseringar och anpassningar för olika delar av kartor»): reglagen
 * «Tydligare kurvbild». Markens höjd läses ur laserjobbets `hojd.png` (alla etapper på en gång), och kurvorna bland
 * kandidaterna som visas jämnas ut och gallras (`clearContours`) utan en ny körning. Efter första «Visa som kandidater»
 * räknas det om en kort stund efter att ett reglage flyttats. Ligger ovanpå «Lugna kurvor på flack mark».
 */
export function MapProjectClearPanel({ view, importer }: { view: MapProjectView; importer: ReturnType<typeof useMapProjectImport> }) {
  const text = useTexts(mapClearContoursSv, mapClearContoursEn);
  const shared = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const base = mapProjectBase(view.projectId);
  type Job = Pick<GeoJobList["jobs"][number], "jobId" | "name" | "status" | "createdAt" | "clip">;
  const [jobs, setJobs] = useState<readonly Job[]>();
  const [chosen, setChosen] = useState("");
  const [settings, setSettings] = useState<ClearSettings>(importer.clear?.settings ?? DEFAULT_CLEAR);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string>();
  const heights = useRef<{ key: string; field: HeightField } | undefined>(undefined);
  const crs = importer.crs, clear = importer.clear;
  const hasContours = importer.layers.some(layer => CONTOURS.test(layer.name));

  async function open() {
    if (jobs) return;
    const result = await clubRequest(`${base}/geo-jobs`).catch(() => ({ status: 0, json: undefined }));
    const list = result.status === 200 ? (result.json as GeoJobList).jobs : [];
    setJobs(list.filter(job => job.status === "DONE" && [HEIGHT_IMAGE, HEIGHT_WORLD].every(name => job.outputs.some(output => output.name === name)))
      .map(job => ({ jobId: job.jobId, name: job.name, status: job.status, createdAt: job.createdAt, clip: job.clip })));
  }
  const choices = jobs ? stageChoices(jobs) : undefined;
  const job = choices?.find(row => row.id === chosen) ?? choices?.[0];

  /** Höjden ur jobbets (eller alla etappers) bilder, i kandidaternas koordinatsystem. */
  async function fieldOf(): Promise<HeightField | undefined> {
    if (!job || crs === undefined) return undefined;
    const key = `${job.id}:${crs}`;
    if (heights.current?.key === key) return heights.current.field;
    const file = (jobId: string, name: string) => fetch(`${base}/geo-jobs/${jobId}/outputs/${name}`, { credentials: "same-origin" }).catch(() => undefined);
    const parts = await Promise.all(job.jobs.map(async row => {
      const [image, world] = await Promise.all([file(row.jobId, HEIGHT_IMAGE), file(row.jobId, HEIGHT_WORLD)]);
      if (!image?.ok || !world?.ok) return undefined;
      const affine = worldFileAffine(await world.text());
      const bitmap = await createImageBitmap(await image.blob()).catch(() => undefined);
      const pixels = bitmap && bitmapPixels(bitmap);
      bitmap?.close();
      if (!affine || !pixels) return undefined;
      const [a, b, c, d, e, f] = affine;
      // Världsfilen ger bildpunkternas mitt; `layerAffine` vill ha hörnen (0,5 = mitten av första punkten).
      const placed: PixelAffine = crs === JOB_CRS ? affine
        : layerAffine((column, line) => [a * (column - 0.5) + b * (line - 0.5) + c, d * (column - 0.5) + e * (line - 0.5) + f], pixels.width, pixels.height, JOB_CRS, crs);
      return { grid: heightGridOf(pixels), affine: placed };
    }));
    const found = parts.filter(part => part !== undefined);
    if (found.length === 0) return undefined;
    const field = heightFieldFrom(found);
    heights.current = { key, field };
    return field;
  }

  const ran = useRef<ClearSettings | undefined>(undefined);
  async function run(next: ClearSettings) {
    ran.current = next;
    setBusy(true); setProblem(undefined);
    try {
      const field = await fieldOf();
      if (!field) { setProblem(text.failed); return; }
      // Ett nyare drag i reglaget under hämtningen räknas i stället.
      if (ran.current === next) importer.clearCurves(next, field);
    } catch (error) {
      console.error("Markens höjd kunde inte läsas", error);
      setProblem(text.failed);
    } finally { setBusy(false); }
  }
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!live || ran.current === settings) return;
    const timer = setTimeout(() => void latest.current(settings), 300);
    return () => clearTimeout(timer);
  }, [live, settings]);

  if (!importer.canImport) return null;
  const smooth = smoothLimitsAt(settings.smooth), formlines = formlineLimitsAt(settings.formlines), ringM2 = ringLimitAt(settings.rings);
  const slider = (key: keyof ClearSettings, label: string) => <label key={key}>{label}
    <input type="range" min={0} max={10} step={1} value={settings[key]} data-testid={`map-project-clear-${key}`}
      onChange={event => setSettings(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>;
  return <details className={styles.settings} data-testid="map-project-clear" onToggle={event => { if (event.currentTarget.open) void open(); }}>
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {jobs && jobs.length === 0 ? <p className={styles.muted}>{text.none}</p> : !hasContours ? <p className={styles.muted}>{text.noContours}</p> : job && <>
      <label>{shared.job}<select value={job.id} onChange={event => { setChosen(event.target.value); setLive(false); }}>
        {choices!.map(row => <option key={row.id} value={row.id}>{row.stages ? shared.allStages(row.stages.base, row.stages.total) : row.jobs[0]!.name}</option>)}
      </select></label>
      {slider("smooth", text.smooth(settings.smooth, number(smooth?.sigma ?? 0), number(Math.round((smooth?.fullSlope ?? 0) * 100)), number(Math.round((smooth?.noSlope ?? 0) * 100))))}
      {slider("formlines", text.formlines(settings.formlines, number(formlines?.minConvex ?? 0), number(formlines?.tight ?? 0)))}
      {slider("rings", text.rings(settings.rings, number(Math.round(ringM2 ?? 0))))}
      <p className={styles.muted}>{text.levelHelp}</p>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => { setLive(true); void run(settings); }} data-testid="map-project-clear-run">{busy ? shared.loading : text.run}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setSettings(DEFAULT_CLEAR)}>{shared.reset}</Button>
      </span>
    </>}
    {problem ? <p role="alert" className={styles.problem} data-testid="map-project-clear-message">{problem}</p>
      : clear && hasContours && <p role="status" data-testid="map-project-clear-message">
        {clear.smoothedMeters + clear.formlineMeters + clear.rings > 0 ? text.done(number(clear.smoothedMeters), number(clear.formlineMeters), clear.rings) : text.untouched}</p>}
  </details>;
}
