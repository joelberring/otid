"use client";

import type { GeoJobList, MapProjectView } from "@o-tid/contracts";
import type { GridPart } from "@o-tid/map-revision/base-map";
import { useRef, useState } from "react";
import { mapDrawingBasisEn } from "../../i18n/map-drawing-basis-en";
import { mapDrawingBasisSv } from "../../i18n/map-drawing-basis-sv";
import { clubRequest } from "../../lib/club-archive-client";
import {
  BASIS_INTERVALS, basisDxf, filesOf, geoTiff, hasHeights, hasVegetation, imageOf, loadGround, loadVegetation,
  type BasisFile, type BasisImage, type BasisJob
} from "../../lib/map-project-drawing-basis";
import { FIELD_PRINT_MAX_PAGES, fieldPrintPdf } from "../../lib/map-project-field-print";
import { mapProjectBase } from "../../lib/map-project-client";
import { stageChoices } from "../../lib/map-project-stages";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import styles from "./map-project-editor.module.css";

const decimal = (value: number) => value.toLocaleString("sv-SE");
const SCALES = [4000, 5000, 7500, 10000] as const;
/** Förvalen: det kartritaren beskrev (diken och låga former, 0,25 m i OCAD, 1 m på plasten). */
const DEFAULT_FILES: readonly BasisFile[] = ["diken.dxf", "knollar.dxf", "kullar.geojson"];

function save(name: string, parts: BlobPart[], type: string) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Underlag för frihandsritning (ägaren 2026-11-16 efter mejl från Högdalens kartritare: «Ritar ändå allt från grunden på
 * skogskartor … vill kunna se kurvning i hög upplösning och objekt-/vegetationshöjd … exportera ut enbart valda symboler»).
 * Läser det klara laserjobbet (alla etapper) och lämnar ut DXF, GeoTIFF och en fältutskrift. Inget läses in i kartan.
 */
export function MapProjectDrawingBasisPanel({ view }: { view: MapProjectView }) {
  const text = useTexts(mapDrawingBasisSv, mapDrawingBasisEn);
  const base = mapProjectBase(view.projectId);
  type Job = Pick<GeoJobList["jobs"][number], "jobId" | "name" | "status" | "createdAt" | "clip" | "outputs">;
  const [jobs, setJobs] = useState<readonly Job[]>();
  const [chosen, setChosen] = useState("");
  const [files, setFiles] = useState<readonly BasisFile[]>(DEFAULT_FILES);
  const [interval, setContourInterval] = useState<number | undefined>(0.25);
  const [smooth, setSmooth] = useState(true);
  const [banks, setBanks] = useState(true);
  const [print, setPrint] = useState({ scale: 5000, paper: "A4" as "A4" | "A3", landscape: false, interval: 1, shade: true, vegetation: false, relief: false });
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ text: string; problem: boolean }>();
  const cache = useRef<{ key: string; ground?: GridPart | undefined; vegetation?: GridPart | undefined }>({ key: "" });

  async function open() {
    if (jobs) return;
    const result = await clubRequest(`${base}/geo-jobs`).catch(() => ({ status: 0, json: undefined }));
    const list = result.status === 200 ? (result.json as GeoJobList).jobs : [];
    setJobs(list.filter(job => job.status === "DONE" && hasHeights(job)));
  }
  const choices = jobs ? stageChoices(jobs) : undefined;
  const choice = choices?.find(row => row.id === chosen) ?? choices?.[0];
  const selected: readonly BasisJob[] = choice?.jobs ?? [];
  const available = filesOf(selected);
  const vegetationSaved = hasVegetation(selected);

  async function ground() {
    if (cache.current.key !== choice?.id) cache.current = { key: choice?.id ?? "" };
    if (!("ground" in cache.current)) cache.current.ground = await loadGround(base, selected);
    return cache.current.ground;
  }
  async function vegetation() {
    await ground();
    if (!("vegetation" in cache.current)) cache.current.vegetation = vegetationSaved ? await loadVegetation(base, selected) : undefined;
    return cache.current.vegetation;
  }
  const fileName = (ending: string) => `${(choice?.jobs[0]?.name ?? "underlag").replace(/ – etapp \d+ av \d+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${ending}`;
  async function work(key: string, task: () => Promise<string | undefined>) {
    setBusy(key); setMessage(undefined);
    // Låt knappens «Räknar …» synas innan det tunga börjar.
    await new Promise(resolve => setTimeout(resolve, 30));
    try { const done = await task(); if (done) setMessage({ text: done, problem: false }); }
    catch (error) {
      const pages = error instanceof Error && /^pages:(\d+)$/.exec(error.message);
      if (!pages) console.error("Underlaget kunde inte göras", error);
      setMessage({ text: pages ? text.tooManyPages(Number(pages[1]), FIELD_PRINT_MAX_PAGES) : text.failed, problem: true });
    } finally { setBusy(undefined); }
  }
  const usedFiles = files.filter(file => available.includes(file));

  const downloadDxf = () => work("dxf", async () => {
    const result = await basisDxf(base, selected, { files: usedFiles, interval, smooth, banks }, interval !== undefined || banks ? await ground() : undefined);
    save(fileName(interval !== undefined ? `kurvor_${String(interval).replace(".", "")}.dxf` : "lager.dxf"), [result.text], "application/dxf");
    return text.dxfDone(result.layers.map(layer => `${layer.name} (${decimal(layer.objects)})`).join(", "));
  });
  const downloadImage = (kind: BasisImage) => work(kind, async () => {
    const image = imageOf(kind, await ground(), kind === "vegetation" ? await vegetation() : undefined);
    if (!image) return text.noVegetation;
    save(fileName(`${{ shade: "skuggning", vegetation: "vegetationshojd", relief: "smaformer" }[kind]}.tif`), [await geoTiff(image.rgb, image.part)], "image/tiff");
    return undefined;
  });
  const downloadPdf = () => work("pdf", async () => {
    const heights = await ground();
    if (!heights) throw new Error("ground");
    const date = new Date().toLocaleDateString("sv-SE");
    const pdf = await fieldPrintPdf(base, selected, heights, print.vegetation ? await vegetation() : undefined,
      { ...print, smooth, banks, files: usedFiles },
      { title: text.printTitle, footer: (page, pages) => text.printFooter(page, pages, decimal(print.scale), decimal(print.interval), date) });
    save(fileName(`falt_1-${print.scale}.pdf`), [pdf as BlobPart], "application/pdf");
    return undefined;
  });

  const check = (checked: boolean, onChange: (value: boolean) => void, label: string, testId?: string) =>
    <label key={label}><input type="checkbox" checked={checked} data-testid={testId} onChange={event => onChange(event.target.checked)} /> {label}</label>;
  return <details className={styles.settings} data-testid="map-project-drawing-basis" onToggle={event => { if (event.currentTarget.open) void open(); }}>
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {jobs && jobs.length === 0 ? <p className={styles.muted}>{text.none}</p> : choice && <>
      <label>{text.job}<select value={choice.id} onChange={event => setChosen(event.target.value)}>
        {choices!.map(row => <option key={row.id} value={row.id}>{row.stages ? text.allStages(row.stages.base, row.stages.total) : row.jobs[0]!.name}</option>)}
      </select></label>

      <h4>{text.dxfHeading}</h4>
      <p className={styles.muted}>{text.dxfHelp}</p>
      <label>{text.contours}<select value={interval ?? ""} data-testid="map-project-basis-interval"
        onChange={event => setContourInterval(event.target.value === "" ? undefined : Number(event.target.value))}>
        {BASIS_INTERVALS.map(value => <option key={value} value={value}>{text.interval(decimal(value))}</option>)}
        <option value="">{text.noContours}</option>
      </select></label>
      {check(smooth, setSmooth, text.smooth)}
      <small className={styles.muted}>{text.smoothHelp}</small>
      {check(banks, setBanks, text.banks, "map-project-basis-banks")}
      <small className={styles.muted}>{text.banksHelp}</small>
      {available.map(file => check(files.includes(file), on => setFiles(current => on ? [...current, file] : current.filter(row => row !== file)), text.files[file] ?? file))}
      <span className={styles.actions}>
        <Button variant="secondary" disabled={!!busy} onClick={() => void downloadDxf()} data-testid="map-project-basis-dxf">{busy === "dxf" ? text.working : text.downloadDxf}</Button>
      </span>

      <h4>{text.imagesHeading}</h4>
      <p className={styles.muted}>{text.imagesHelp}</p>
      <span className={styles.actions}>
        {(["shade", "vegetation", "relief"] as const).filter(kind => kind !== "vegetation" || vegetationSaved).map(kind =>
          <Button key={kind} variant="secondary" disabled={!!busy} onClick={() => void downloadImage(kind)}>{busy === kind ? text.working : text[kind]}</Button>)}
      </span>

      <h4>{text.printHeading}</h4>
      <p className={styles.muted}>{text.printHelp}</p>
      <label>{text.scale}<select value={print.scale} onChange={event => setPrint(current => ({ ...current, scale: Number(event.target.value) }))}>
        {SCALES.map(scale => <option key={scale} value={scale}>1:{decimal(scale)}</option>)}
      </select></label>
      <label>{text.paper}<select value={print.paper} onChange={event => setPrint(current => ({ ...current, paper: event.target.value as "A4" | "A3" }))}>
        <option value="A4">A4</option><option value="A3">A3</option>
      </select></label>
      {check(print.landscape, on => setPrint(current => ({ ...current, landscape: on })), text.landscape)}
      <label>{text.printInterval}<select value={print.interval} onChange={event => setPrint(current => ({ ...current, interval: Number(event.target.value) }))}>
        {BASIS_INTERVALS.map(value => <option key={value} value={value}>{text.interval(decimal(value))}</option>)}
      </select></label>
      <p className={styles.muted}>{text.printLayers}. {text.printLayersHelp}</p>
      {check(print.shade, on => setPrint(current => ({ ...current, shade: on })), text.shade)}
      {vegetationSaved && check(print.vegetation, on => setPrint(current => ({ ...current, vegetation: on })), text.vegetation)}
      {check(print.relief, on => setPrint(current => ({ ...current, relief: on })), text.relief)}
      <span className={styles.actions}>
        <Button variant="secondary" disabled={!!busy} onClick={() => void downloadPdf()} data-testid="map-project-basis-pdf">{busy === "pdf" ? text.working : text.downloadPdf}</Button>
      </span>
    </>}
    {message && <p role={message.problem ? "alert" : "status"} className={message.problem ? styles.problem : styles.muted} data-testid="map-project-basis-message">{message.text}</p>}
  </details>;
}
