"use client";

import type { MapGeoreference } from "@o-tid/map-file";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { DEFAULT_DEPTH, depthCandidates } from "../../lib/map-project-moisture-depth";
import { DEFAULT_GREEN, greenCandidates, type BorderLevel } from "../../lib/map-project-green-classes";
import { mapForestEn } from "../../i18n/map-forest-en";
import { mapForestSv } from "../../i18n/map-forest-sv";
import { useTexts } from "../language-provider";
import { MapProjectRasterPanel } from "./map-project-raster-panel";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";

const decimal = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");
type Props = { layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference; importer: ReturnType<typeof useMapProjectImport> };

/** Fukt med reglage: gränserna för blött och fuktigt i laserkörningens fuktdjup (underlaget som slutar på «fuktdjup»). */
export function MapProjectDepthPanel(props: Props) {
  const text = useTexts(mapSourcesSv.depth, mapSourcesEn.depth);
  return <MapProjectRasterPanel {...props} match={/fuktdjup$/} own={/^(blott|fuktigt)$/} text={text} testId="map-project-depth" initial={DEFAULT_DEPTH}
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
    compute={(pixels, settings, toSource, crs, cell) => {
      const result = depthCandidates(pixels, settings, toSource, crs, cell);
      return { data: result.data, message: text.done(decimal(result.wetHa), decimal(result.moistHa)) };
    }} />;
}

/** Grönt med reglage: stegen för 406, 408 och 410 i vegetationens klasser (underlaget som slutar på «vegetationsklasser»). */
export function MapProjectGreenPanel(props: Props) {
  const text = useTexts(mapSourcesSv.green, mapSourcesEn.green);
  const forest = useTexts(mapForestSv, mapForestEn);
  return <MapProjectRasterPanel {...props} match={/vegetationsklasser$/} own={/^(oppen_mark|oppen_mark_laser|gron_|undervegetation_|bestandsgrans_laser$)/} text={text} testId="map-project-green" initial={DEFAULT_GREEN}
    controls={(settings, change) => <>
      {(["slow", "difficult", "fight"] as const).map(key => <label key={key}>{text.step(key, settings[key])}
        <input type="range" min={0} max={12} step={1} value={settings[key]} data-testid={`map-project-green-${key}`} onChange={event => {
          const value = Number(event.target.value);
          // Stegen hålls i ordning: 406 ≤ 408 ≤ 410.
          change(key === "slow" ? { slow: value, difficult: Math.max(settings.difficult, value), fight: Math.max(settings.fight, value) }
            : key === "difficult" ? { difficult: value, slow: Math.min(settings.slow, value), fight: Math.max(settings.fight, value) }
            : { fight: value, slow: Math.min(settings.slow, value), difficult: Math.min(settings.difficult, value) });
        }} /></label>)}
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
