"use client";

import { useMapProjectFailure } from "./use-map-project-failure";
import { useState, type FormEvent } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { useLanguage, useTexts } from "../language-provider";
import { MAP_PROJECT_NEW_SCALES } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { areaCenterWgs84, areaFromCenter, areaFromGeoJson, parseLatLon, type AreaInput } from "../../lib/map-project-area-input";
import { declinationAt } from "@o-tid/map-file";
import { mapProjectsBase } from "../../lib/map-project-client";
import { Button, Field, Notice } from "../ui";
import styles from "./map-project.module.css";

type Norm = keyof typeof MAP_PROJECT_NEW_SCALES;
const NORMS = Object.keys(MAP_PROJECT_NEW_SCALES) as Norm[];

/**
 * ADR-0219 (K1): ett nytt projekt med en ny tom karta. Normen ger O-Tids symbolset och skalorna; området kommer från en
 * GeoJSON-fil (polygonen, t.ex. strandlinjen runt en ö) eller en mittpunkt med bredd och höjd. Kartan skapas på servern.
 */
export function NewMapProject() {
  const failure = useMapProjectFailure();
  const text = useTexts(mapProjectSv.newMap, mapProjectEn.newMap);
  const [name, setName] = useState("");
  const [norm, setNorm] = useState<Norm>("ISOM2017-2");
  const [scale, setScale] = useState<number>(MAP_PROJECT_NEW_SCALES["ISOM2017-2"][0]);
  const [source, setSource] = useState<"file" | "center">("file");
  const [fileArea, setFileArea] = useState<AreaInput>();
  const [center, setCenter] = useState("");
  const [width, setWidth] = useState("1500");
  const [height, setHeight] = useState("1500");
  const language = useLanguage();
  const [declination, setDeclination] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function area(): AreaInput | undefined {
    if (source === "file") return fileArea;
    const point = parseLatLon(center);
    const w = Number(width), h = Number(height);
    return point && w > 0 && h > 0 ? areaFromCenter(point, w, h) : undefined;
  }

  // ADR-0223: dagens missvisning enligt World Magnetic Model i områdets mitt (används när fältet är tomt).
  const chosenArea = area();
  const middle = chosenArea ? areaCenterWgs84(chosenArea) : undefined;
  const suggested = middle ? declinationAt(middle.latitude, middle.longitude, new Date()) : undefined;

  async function create(event: FormEvent) {
    event.preventDefault();
    const chosen = area();
    if (!chosen) { setMessage(source === "file" ? text.badFile : text.badCenter); return; }
    setBusy(true); setMessage("");
    try {
      const value = declination.trim() ? Number(declination.replace(",", ".")) : undefined;
      const result = await clubRequest(`${mapProjectsBase}/new`, "POST", { formatVersion: 1, requestId, name: name.trim(), symbolSet: norm, scale,
        ...(value !== undefined && Number.isFinite(value) ? { declination: value } : {}), area: chosen });
      if (result.status === 200 || result.status === 201) {
        window.location.assign(`/organizer/map-projects/${encodeURIComponent((result.json as { projectId: string }).projectId)}/map`);
        return;
      }
      setRequestId(crypto.randomUUID());
      const error = result.status === 422 ? (result.json as { error?: string } | undefined)?.error : undefined;
      setMessage(error === "AREA_TOO_LARGE" ? text.tooLarge : error === "STORAGE_QUOTA_EXCEEDED" ? text.quota
        : result.status === 400 ? text.invalid : failure(result.status));
    } catch { setMessage(failure(0)); } finally { setBusy(false); }
  }

  const ready = !!name.trim() && (source === "file" ? !!fileArea : !!center.trim());
  return <section id="nytt-kartprojekt" aria-labelledby="map-project-new">
    <h2 id="map-project-new">{text.title}</h2>
    <p className={styles.muted}>{text.help}</p>
    <form className={styles.form} onSubmit={event => void create(event)} aria-label={text.title}>
      <Field label={text.name}><input value={name} maxLength={120} required onChange={event => setName(event.target.value)} /></Field>
      <Field label={text.norm}><select value={norm} onChange={event => {
        const next = event.target.value as Norm;
        setNorm(next); setScale(MAP_PROJECT_NEW_SCALES[next][0]);
      }}>{NORMS.map(entry => <option key={entry} value={entry}>{text.norms[entry]}</option>)}</select></Field>
      <Field label={text.scale}><select value={scale} onChange={event => setScale(Number(event.target.value))}>
        {MAP_PROJECT_NEW_SCALES[norm].map(entry => <option key={entry} value={entry}>1:{entry.toLocaleString("sv-SE")}</option>)}
      </select></Field>
      <fieldset className={styles.choice}>
        <legend>{text.area}</legend>
        <label><input type="radio" name="area-source" checked={source === "file"} onChange={() => setSource("file")} /> {text.areaFile}</label>
        <label><input type="radio" name="area-source" checked={source === "center"} onChange={() => setSource("center")} /> {text.areaCenter}</label>
      </fieldset>
      {source === "file" ? <Field label={text.geojson} help={text.areaFileHelp}>
        <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={event => {
          const chosen = event.target.files?.[0];
          setFileArea(undefined); setMessage("");
          if (!chosen) return;
          void chosen.text().then(content => {
            const parsed = areaFromGeoJson(content);
            setFileArea(parsed);
            if (!parsed) setMessage(text.badFile);
            if (!name.trim()) setName(chosen.name.replace(/\.[A-Za-z0-9]{2,7}$/, "").slice(0, 120));
          });
        }} />
      </Field> : <>
        <Field label={text.center} help={text.centerHelp}><input value={center} inputMode="decimal" onChange={event => setCenter(event.target.value)} /></Field>
        <div className={styles.row}>
          <Field label={text.width}><input type="number" min={50} max={15000} step={50} value={width} onChange={event => setWidth(event.target.value)} /></Field>
          <Field label={text.height}><input type="number" min={50} max={15000} step={50} value={height} onChange={event => setHeight(event.target.value)} /></Field>
        </div>
      </>}
      {source === "file" && fileArea && <p className={styles.muted} data-testid="new-map-area">
        {text.areaSummary(fileArea.rings.length, fileArea.rings.reduce((sum, ring) => sum + ring.length, 0))}</p>}
      <Field label={text.declination} help={suggested !== undefined ? text.declinationSuggested(suggested.toLocaleString(language === "en" ? "en-GB" : "sv-SE"))
        : text.declinationHelp}>
        <input value={declination} inputMode="decimal" placeholder={suggested !== undefined ? String(suggested) : undefined}
          onChange={event => setDeclination(event.target.value)} /></Field>
      <div className={styles.actions}><Button type="submit" disabled={busy || !ready} aria-busy={busy}>{text.button}</Button></div>
      {message && <Notice tone="error" role="alert">{message}</Notice>}
    </form>
  </section>;
}
