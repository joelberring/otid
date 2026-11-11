"use client";

import { FOREST_IMAGE_PRODUCTS, type ForestImageProduct, type MapProjectClearCut, type MapProjectClearCutList, type MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { useEffect, useRef, useState } from "react";
import { mapForestEn } from "../../i18n/map-forest-en";
import { mapForestSv } from "../../i18n/map-forest-sv";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { clubRequest, csrf } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { clearCutFeatures, DEFAULT_CLEAR_CUT_AGES, type ClearCutAges } from "../../lib/map-project-clear-cuts";
import { mapProjectBase } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

type Area = BoxArea & { areaId: string };
interface Props { view: MapProjectView; layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference | undefined; bounds: Bounds | undefined;
  areas: readonly Area[]; importer: ReturnType<typeof useMapProjectImport> }

function AreaSelect({ areas, where, setWhere, label, whole }: { areas: readonly Area[]; where: string; setWhere: (value: string) => void; label: string; whole: string }) {
  return <label>{label}<select value={where} onChange={event => setWhere(event.target.value)}>
    <option value="">{whole}</option>
    {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
  </select></label>;
}

/**
 * Ägaren 2026-11-11 («tända/släcka bakgrundsinfo från Skogsstyrelsen»): Skogsstyrelsens kartbilder (hyggen, anmälningar,
 * nyckelbiotoper, trädhöjd) hämtas för kartan eller en etapp och läggs som vanliga underlag, som tänds, släcks och tonas under
 * Lager.
 */
export function MapProjectForestImagePanel({ view, layers, georeference, bounds, areas }: Props) {
  const text = useTexts(mapForestSv.images, mapForestEn.images);
  const sources = useTexts(mapSourcesSv, mapSourcesEn);
  const [where, setWhere] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<ForestImageProduct>>(new Set(["CLEAR_CUTS", "TREE_HEIGHT"]));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  if (!layers.canAdd || !georeference || !bounds) return null;
  const area = areas.find(row => row.areaId === where);
  const problems = sources.laser.problems as unknown as Record<string, string>;

  async function fetchImages() {
    setBusy(true); setMessage(undefined);
    let added = 0;
    try {
      for (const product of FOREST_IMAGE_PRODUCTS.filter(item => chosen.has(item))) {
        const token = csrf();
        const response = await fetch(`${mapProjectBase(view.projectId)}/sources/skogsstyrelsen`, { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json", ...(token ? { "x-otid-csrf": token } : {}) },
          body: JSON.stringify({ formatVersion: 1, box: areaBox(bounds!, georeference!, area).wgs84, product }) }).catch(() => undefined);
        if (!response?.ok) {
          const body = await response?.json().catch(() => undefined) as { error?: string } | undefined;
          setMessage({ tone: "error", text: body?.error && body.error in problems ? problems[body.error]! : sources.laser.problems.generic(response?.status ?? 0) });
          return;
        }
        const world = decodeURIComponent(response.headers.get("x-otid-world") ?? "");
        const files = [new File([await response.blob()], "skogsstyrelsen.png", { type: "image/png" }), new File([world], "skogsstyrelsen.pgw", { type: "text/plain" })];
        if (await layers.upload(files, text.name(text.products[product].toLowerCase(), area?.name), 3006)) added += 1;
      }
      setMessage({ tone: "ok", text: text.added(added) });
    } finally { setBusy(false); }
  }

  return <details className={styles.settings} data-testid="map-project-forest-images">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    <AreaSelect areas={areas} where={where} setWhere={setWhere} label={sources.ortho.where} whole={sources.ortho.whole} />
    {FOREST_IMAGE_PRODUCTS.map(product => <label key={product} className={styles.check}>
      <input type="checkbox" checked={chosen.has(product)} onChange={() => setChosen(current => {
        const next = new Set(current); if (next.has(product)) next.delete(product); else next.add(product); return next;
      })} /> {text.products[product]}</label>)}
    <span className={styles.actions}>
      <Button variant="secondary" disabled={busy || chosen.size === 0} onClick={() => void fetchImages()} data-testid="map-project-forest-images-fetch">{text.fetch}</Button>
    </span>
    {busy && <p role="status" className={styles.muted}>{text.fetching}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-forest-images-message">{message.text}</p>}
    <p className={styles.muted}>{text.attribution}</p>
  </details>;
}

/**
 * Ägaren 2026-11-11 («testa olika körningar»): Skogsstyrelsens hyggen hämtas en gång, och åldrarna för färskt, sly och ungskog
 * dras med reglage; kandidaterna räknas om direkt (utan laserns skanningsdatum: det gör grundkartan).
 */
export function MapProjectClearCutPanel({ view, georeference, bounds, areas, importer }: Props) {
  const text = useTexts(mapForestSv.cuts, mapForestEn.cuts);
  const sources = useTexts(mapSourcesSv, mapSourcesEn);
  const [where, setWhere] = useState("");
  const [cuts, setCuts] = useState<readonly MapProjectClearCut[]>();
  const [ages, setAges] = useState<ClearCutAges>(DEFAULT_CLEAR_CUT_AGES);
  const [borders, setBorders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const latest = useRef<() => void>(() => undefined);
  latest.current = () => {
    if (!cuts) return;
    const result = clearCutFeatures(cuts, new Date().toISOString().slice(0, 10), null, ages, borders);
    if (!result.features.length) { setMessage({ tone: "error", text: text.none }); return; }
    importer.openData(text.name, { features: result.features, skipped: 0, crs: 3006 }, true);
    setMessage({ tone: "ok", text: text.done(result.counts.fresh, result.counts.scrub, result.counts.young, cuts.length) });
  };
  useEffect(() => {
    if (!cuts) return;
    const timer = setTimeout(() => latest.current(), 200);
    return () => clearTimeout(timer);
  }, [cuts, ages, borders]);
  if (!importer.canImport || !georeference || !bounds) return null;
  const area = areas.find(row => row.areaId === where);

  async function fetchCuts() {
    setBusy(true); setMessage(undefined);
    try {
      const response = await clubRequest(`${mapProjectBase(view.projectId)}/sources/avverkningar`, "POST",
        { formatVersion: 1, box: areaBox(bounds!, georeference!, area).wgs84 }).catch(() => ({ status: 0, json: undefined }));
      const list = response.status === 200 ? response.json as MapProjectClearCutList | undefined : undefined;
      if (!list) { setMessage({ tone: "error", text: text.failed }); return; }
      setCuts(list.cuts);
    } finally { setBusy(false); }
  }
  const slider = (key: keyof ClearCutAges, label: string, min: number, max: number) => <label>{label}
    <input type="range" min={min} max={max} step={1} value={ages[key]} data-testid={`map-project-cuts-${key}`} onChange={event => {
      const value = Number(event.target.value);
      // Åldrarna hålls i ordning: färskt < sly < ungskog.
      setAges(current => key === "fresh" ? { fresh: value, scrub: Math.max(current.scrub, value + 1), young: Math.max(current.young, value + 2) }
        : key === "scrub" ? { fresh: Math.min(current.fresh, value - 1), scrub: value, young: Math.max(current.young, value + 1) }
        : { fresh: Math.min(current.fresh, value - 2), scrub: Math.min(current.scrub, value - 1), young: value });
    }} /></label>;

  return <details className={styles.settings} data-testid="map-project-cuts">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    <AreaSelect areas={areas} where={where} setWhere={setWhere} label={sources.ortho.where} whole={sources.ortho.whole} />
    <span className={styles.actions}><Button variant="secondary" disabled={busy} onClick={() => void fetchCuts()} data-testid="map-project-cuts-fetch">{text.fetch}</Button></span>
    {cuts && <>
      {slider("fresh", text.fresh(ages.fresh), 1, 8)}
      {slider("scrub", text.scrub(ages.scrub), 2, 15)}
      {slider("young", text.young(ages.young), 3, 30)}
      <label className={styles.check}><input type="checkbox" checked={borders} onChange={() => setBorders(value => !value)} /> {text.borders}</label>
    </>}
    {busy && <p role="status" className={styles.muted}>{text.fetching}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-cuts-message">{message.text}</p>}
  </details>;
}
