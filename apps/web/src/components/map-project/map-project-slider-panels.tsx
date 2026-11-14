"use client";

import type { MapProjectSoilArea, MapProjectSoilList, MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { useEffect, useRef, useState } from "react";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { depthAt, greenAt } from "../../lib/map-project-amount";
import { DEFAULT_DEPTH, depthCandidates } from "../../lib/map-project-moisture-depth";
import { DEFAULT_GREEN, greenCandidates, type BorderLevel } from "../../lib/map-project-green-classes";
import { mapForestEn } from "../../i18n/map-forest-en";
import { mapForestSv } from "../../i18n/map-forest-sv";
import { mapRockEn } from "../../i18n/map-rock-en";
import { mapRockSv } from "../../i18n/map-rock-sv";
import { DEFAULT_ROCK_LEVEL, marshOffDrySoil, ROCK_LAYERS, rockAreas, SOIL_PANEL_LAYERS, soilForMarsh } from "@o-tid/map-revision/base-map";
import { useTexts } from "../language-provider";
import { MapProjectRasterPanel } from "./map-project-raster-panel";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

const decimal = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");
type Props = { layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference; importer: ReturnType<typeof useMapProjectImport> };

/**
 * Fukt med reglage: gränserna för blött och fuktigt i laserkörningens fuktdjup (underlaget som slutar på «fuktdjup»). Ägaren 2026-11-13
 * («markfukten blir rätt hög … med flack mark, tror sandig»): SGU:s jordartskarta hämtas en gång för kartans ruta, och sand och grus
 * tar bort blött och fuktigt (`marshOffDrySoil`); kryssrutan stänger av det. Går hämtningen fel fungerar reglaget som förut.
 */
export function MapProjectDepthPanel(props: Props & { view: MapProjectView; bounds: Bounds | undefined }) {
  const text = useTexts(mapSourcesSv.depth, mapSourcesEn.depth);
  const { view, bounds, georeference, layers } = props;
  const [noDrySoil, setNoDrySoil] = useState(true);
  const [soil, setSoil] = useState<readonly MapProjectSoilArea[] | "failed" | undefined>();
  const asked = useRef(false);
  // Ägaren 2026-11-14: jordarterna hämtades varje gång kartan öppnades (15 sekunder på Ornö södra); nu först när panelen fälls ut.
  const [opened, setOpened] = useState(false);
  const crs = georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined;
  const hasDepth = layers.loaded.some(drawn => /fuktdjup$/.test(layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId));
  // Jordarterna hämtas en gång per panel, när den fällts ut, det finns ett fuktdjup och regeln är på (och kartan ligger i SWEREF 99 TM, som SGU).
  useEffect(() => {
    if (!opened || !noDrySoil || !hasDepth || asked.current || !bounds || crs !== 3006) return;
    asked.current = true;
    void clubRequest(`${mapProjectBase(view.projectId)}/sources/jordarter`, "POST", { formatVersion: 1, box: areaBox(bounds, georeference, undefined).wgs84 })
      .catch(() => ({ status: 0, json: undefined })).then(response => {
        const listed = response.status === 200 ? response.json as MapProjectSoilList | undefined : undefined;
        setSoil(listed && Array.isArray(listed.areas) ? soilForMarsh(listed.areas) : "failed");
      });
  }, [opened, noDrySoil, hasDepth, bounds, crs, georeference, view.projectId]);
  const areas = noDrySoil && Array.isArray(soil) ? soil as readonly MapProjectSoilArea[] : undefined;
  return <MapProjectRasterPanel {...props} match={/fuktdjup$/} own={/^(blott|fuktigt)$/} text={text} testId="map-project-depth" initial={DEFAULT_DEPTH} atLevel={depthAt}
    refreshKey={areas ?? noDrySoil} onOpen={() => setOpened(true)}
    extras={<>
      <label className={styles.check}><input type="checkbox" checked={noDrySoil} onChange={() => setNoDrySoil(value => !value)} data-testid="map-project-depth-soil" /> {text.noDrySoil}</label>
      <p className={styles.muted}>{text.noDrySoilHelp} {text.soilAttribution}</p>
      {noDrySoil && soil === "failed" && <p role="status" className={styles.muted} data-testid="map-project-depth-soil-failed">{text.soilFailed}</p>}
    </>}
    controls={(settings, change) => <>
      <label>{text.wet(decimal(settings.wetMeters))}<input type="range" min={0.1} max={2} step={0.05} value={settings.wetMeters}
        onChange={event => { const wet = Number(event.target.value); change({ wetMeters: wet, moistMeters: Math.max(settings.moistMeters, wet + 0.1) }); }}
        data-testid="map-project-depth-wet" /></label>
      <label>{text.moist(decimal(settings.moistMeters))}<input type="range" min={0.2} max={3} step={0.05} value={settings.moistMeters}
        onChange={event => change({ moistMeters: Math.max(Number(event.target.value), settings.wetMeters + 0.1) })} data-testid="map-project-depth-moist" /></label>
      <label>{text.slope(decimal(settings.wetSlopeDegrees ?? 3))}<input type="range" min={1} max={15} step={0.5} value={settings.wetSlopeDegrees ?? 3}
        onChange={event => change({ wetSlopeDegrees: Number(event.target.value) })} data-testid="map-project-depth-slope" /></label>
      <label>{text.openGround(Math.round((settings.openGroundShare ?? 0.8) * 100))}<input type="range" min={0.4} max={1} step={0.05}
        value={settings.openGroundShare ?? 0.8} onChange={event => change({ openGroundShare: Number(event.target.value) })} data-testid="map-project-depth-open" /></label>
      <label>{text.minArea(settings.minAreaM2)}<input type="range" min={100} max={2000} step={50} value={settings.minAreaM2}
        onChange={event => change({ minAreaM2: Number(event.target.value) })} /></label>
    </>}
    compute={(pixels, settings, toSource, crsOf, cell) => {
      const result = depthCandidates(pixels, settings, toSource, crsOf, cell);
      const off = areas && crsOf === 3006 ? marshOffDrySoil(result.data.features, areas, { layers: SOIL_PANEL_LAYERS, minAreaM2: settings.minAreaM2 }) : undefined;
      return { data: off ? { ...result.data, features: off.features } : result.data,
        message: text.done(decimal(result.wetHa), decimal(result.moistHa), off && off.removedHa > 0 ? decimal(off.removedHa) : undefined) };
    }} />;
}

/** Grönt med reglage: stegen för 406, 408 och 410 i vegetationens klasser (underlaget som slutar på «vegetationsklasser»). */
export function MapProjectGreenPanel(props: Props) {
  const text = useTexts(mapSourcesSv.green, mapSourcesEn.green);
  const forest = useTexts(mapForestSv, mapForestEn);
  return <MapProjectRasterPanel {...props} match={/vegetationsklasser$/} own={/^(oppen_mark|oppen_mark_laser|gron_|undervegetation_|bestandsgrans_laser$)/} text={text} testId="map-project-green" initial={DEFAULT_GREEN} atLevel={greenAt}
    controls={(settings, change) => <>
      {(["slow", "difficult", "fight"] as const).map(key => <label key={key}>{text.step(key, settings[key])}
        <input type="range" min={0} max={12} step={1} value={settings[key]} data-testid={`map-project-green-${key}`} onChange={event => {
          const value = Number(event.target.value);
          // Stegen hålls i ordning: 406 ≤ 408 ≤ 410.
          change(key === "slow" ? { slow: value, difficult: Math.max(settings.difficult, value), fight: Math.max(settings.fight, value) }
            : key === "difficult" ? { difficult: value, slow: Math.min(settings.slow, value), fight: Math.max(settings.fight, value) }
            : { fight: value, slow: Math.min(settings.slow, value), difficult: Math.min(settings.difficult, value) });
        }} /></label>)}
      <label>{text.dense(Math.round((settings.denseShare ?? DEFAULT_GREEN.denseShare!) * 100))}
        <input type="range" min={0.03} max={0.3} step={0.01} value={settings.denseShare ?? DEFAULT_GREEN.denseShare} data-testid="map-project-green-dense"
          onChange={event => change({ denseShare: Number(event.target.value) })} /></label>
      <label>{text.minArea(settings.minAreaM2)}<input type="range" min={100} max={2000} step={50} value={settings.minAreaM2}
        onChange={event => change({ minAreaM2: Number(event.target.value) })} /></label>
      <label>{forest.borders.label}<select value={settings.borders ?? "none"} onChange={event => change({ borders: event.target.value as BorderLevel })}
        data-testid="map-project-green-borders">
        {(["none", "few", "some", "many"] as const).map(level => <option key={level} value={level}>{forest.borders.levels[level]}</option>)}
      </select></label>
      <label><input type="checkbox" checked={settings.undergrowth} onChange={() => change({ undergrowth: !settings.undergrowth })} /> {text.undergrowth}</label>
    </>}
    compute={(pixels, settings, toSource, crs, cell) => {
      const result = greenCandidates(pixels, settings, toSource, crs, cell);
      return { data: result.data, message: text.done(decimal(result.hectares.gron_lattlopt ?? 0), decimal(result.hectares.gron_svarlopt ?? 0),
        decimal(result.hectares.gron_mycket_svarlopt ?? 0)) };
    }} />;
}

/**
 * Berg i dagen med reglage (ägaren 2026-11-13): ytorna ur körningens bergbild (underlaget som slutar på « – berg») för en mängd
 * 1–10, med restriktivt förval. Regeln finns i `rockAreas` (`@o-tid/map-revision/base-map`). Bara mängden finns som reglage.
 */
export function MapProjectRockPanel(props: Props) {
  const text = useTexts(mapRockSv, mapRockEn);
  return <MapProjectRasterPanel {...props} match={/ – berg$/} own={ROCK_LAYERS} text={text} testId="map-project-rock" initial={{ level: DEFAULT_ROCK_LEVEL }}
    initialLevel={DEFAULT_ROCK_LEVEL} atLevel={level => ({ level })}
    compute={(pixels, settings, toSource, crs, cell) => {
      const result = rockAreas(pixels, settings.level, cell, toSource, crs);
      return { data: result.data, message: text.done(result.areas, decimal(result.hectares)) };
    }} />;
}
