"use client";

import { useMemo, useState } from "react";
import { mapNorthFacts, mapPointToProjected, northLineSegments, northLineSpacing, type MapGeoreference } from "@o-tid/map-file";
import { mapProjectNorthEn } from "../../i18n/map-project-north-en";
import { mapProjectNorthSv } from "../../i18n/map-project-north-sv";
import type { Bounds } from "../../lib/course-setting-viewport";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";
import { swedishToday } from "@o-tid/domain";

const today = () => swedishToday(new Date());

/**
 * ADR-0223: kartans nordlinjer jämförda med dagens magnetiska nord i referenspunkten (World Magnetic Model 2025). Visar hur
 * mycket en äldre karta pekar fel; omriktningen är nästa steg.
 *
 * Ägaren 2026-11-14 («hur lägger man till meridianer?»): «Rita nordlinjer» lägger raka, parallella nordlinjer (601) över hela
 * kartan som kandidater, i kartans egen riktning eller mot dagens magnetiska nord, med normens avstånd.
 */
const LAYER = "nordlinjer";
export function MapProjectNorthPanel({ georeference, northLines, bounds, importer, symbols }: { georeference: MapGeoreference; northLines?: number | undefined;
  bounds?: Bounds | undefined; importer?: ReturnType<typeof useMapProjectImport> | undefined; symbols?: ReadonlyMap<string, CatalogSymbol> | undefined }) {
  const text = useTexts(mapProjectNorthSv, mapProjectNorthEn);
  const date = today();
  const facts = useMemo(() => {
    try { return mapNorthFacts(georeference, date, northLines); } catch { return null; }
  }, [georeference, date, northLines]);
  // En karta utan nordlinjer och utan vinkel är ritad mot nätets norr: då är dagens magnetiska nord förvalet.
  const [toward, setToward] = useState<"map" | "today">();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const direction = toward ?? (northLines === undefined && georeference.grivationDegrees === 0 ? "today" : "map");
  const spacing = northLineSpacing(georeference.scale);
  function draw() {
    if (!facts || !importer || georeference.crs.kind !== "EPSG") return;
    const lines = [...(symbols?.values() ?? [])].filter(symbol => symbol.kind === "line" && /^601(\.|$)/.test(symbol.code));
    const symbol = lines.find(row => row.code === "601") ?? lines.find(row => row.code === "601.1") ?? lines[0];
    if (!symbol) { setMessage({ tone: "error", text: text.draw.noSymbol }); return; }
    if (!bounds) { setMessage({ tone: "error", text: text.draw.noArea }); return; }
    // Kartans uppåt pekar `grivationDegrees` medurs från nätets norr; magnetisk nord pekar missvisningen minus konvergensen.
    const degrees = direction === "map" ? georeference.grivationDegrees + (northLines ?? 0) : facts.magnetic.degrees - facts.convergence;
    const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]
      .map(point => mapPointToProjected(georeference, point));
    const segments = northLineSegments(corners, degrees, spacing, georeference.refPoint);
    if (segments.length === 0) { setMessage({ tone: "error", text: text.draw.noArea }); return; }
    importer.openData(text.draw.name, { crs: georeference.crs.code, skipped: 0,
      features: segments.map(([from, to]) => ({ layer: LAYER, geometry: { kind: "line" as const, closed: false, points: [[from.easting, from.northing], [to.easting, to.northing]] as const } })) });
    importer.choose(LAYER, symbol.id);
    // Visas andra kandidater som inte är införda frågar raden under kartan först; då sägs inget här.
    setMessage(importer.file && importer.file.name !== text.draw.name && importer.file.data.features.length > 0 ? undefined
      : { tone: "ok", text: text.draw.done(segments.length, symbol.code) });
  }
  return <details className={styles.settings} data-testid="map-project-north">
    <summary>{text.heading}</summary>
    {!facts ? <p>{text.noGeoreference}</p> : <>
      {/* Översynen G2: en karta utan vinkel (0°) är oftast en fil där vinkeln aldrig satts, inte en karta ritad mot nätnorr. */}
      {/* Ägaren 2026-11-10: finns nordlinjer (601) i kartan är det de som gäller, inte filens vinkel. */}
      <p data-testid="map-project-north-map">{northLines !== undefined ? text.lines(facts.mapDeclination, northLines)
        : georeference.grivationDegrees === 0 ? text.noAngle(facts.mapDeclination) : text.map(facts.mapDeclination)}</p>
      <p>{text.today(facts.magnetic.degrees, date)}</p>
      <p><strong>{text.difference(facts.difference)}</strong></p>
      {!facts.magnetic.valid && <p>{text.invalid}</p>}
      <p>{text.later}</p>
      {importer?.canImport && <>
        <h4>{text.draw.heading}</h4>
        <label>{text.draw.direction}<select value={direction} onChange={event => setToward(event.target.value === "today" ? "today" : "map")} data-testid="map-project-north-direction">
          <option value="map">{text.draw.asMap(facts.mapDeclination)}</option>
          <option value="today">{text.draw.today(facts.magnetic.degrees)}</option>
        </select></label>
        <p className={styles.muted}>{text.draw.spacing(spacing, Math.round(spacing / georeference.scale * 10000) / 10)}</p>
        {northLines !== undefined && <p className={styles.muted}>{text.draw.existing}</p>}
        <span className={styles.actions}><Button variant="secondary" onClick={draw} data-testid="map-project-north-draw">{text.draw.run}</Button></span>
        {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.problem : undefined} data-testid="map-project-north-message">{message.text}</p>}
      </>}
    </>}
  </details>;
}
