"use client";

import type { MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference, Point } from "@o-tid/map-file";
import type { Bounds } from "../../lib/course-setting-viewport";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { MapProjectDepthPanel, MapProjectGreenPanel, MapProjectRockPanel } from "./map-project-slider-panels";
import { MapProjectFolderIntake } from "./map-project-folder-intake";
import { MapProjectGuide } from "./map-project-guide";
import { MapProjectClearCutPanel, MapProjectForestImagePanel } from "./map-project-forest-panels";
import { MapProjectImportPanel } from "./map-project-import-panel";
import { MapProjectLaserPanel } from "./map-project-laser-panel";
import { MapProjectLayersPanel } from "./map-project-layers-panel";
import { MapProjectPhotoPanel } from "./map-project-photo-panel";
import { mapUnderlayStepsEn } from "../../i18n/map-knolls-en";
import { mapUnderlayStepsSv } from "../../i18n/map-knolls-sv";
import { useTexts } from "../language-provider";
import styles from "./map-project-editor.module.css";
import { MapProjectHillPanel } from "./map-project-hill-panel";
import { MapProjectCliffPanel, MapProjectKnollPanel, MapProjectPitPanel } from "./map-project-knoll-panel";
import { MapProjectClearPanel } from "./map-project-clear-panel";
import { MapProjectFlatPanel } from "./map-project-flat-panel";
import { MapProjectDrawingBasisPanel } from "./map-project-drawing-basis-panel";
import { MapProjectMoisturePanel } from "./map-project-moisture-panel";
import { MapProjectOrthoPanel } from "./map-project-ortho-panel";
import { MapProjectWmsPanel } from "./map-project-wms-panel";
import { MapProjectStep } from "./map-project-step";
import type { useMapProjectControlPoints } from "./use-map-project-control-points";
import type { useMapProjectImport } from "./use-map-project-import";
import { useMapProjectLaser } from "./use-map-project-laser";
import type { useMapProjectLayers } from "./use-map-project-layers";
import type { useMapProjectWorkLayers } from "./use-map-project-work-layers";

/**
 * Underlagen i editorns sidopanel (översynen 2026-11-10 G1: utbrutet ur `map-project-editor.tsx`): bilderna med passpunkter,
 * ortofoto, markfuktighet, laser, vektorimporten och mappen med äldre underlag. Bara när kartan har en georeferens.
 */
export function MapProjectUnderlayPanels({ view, georeference, bounds, areas, layers, control, importer, symbols, work, onSplit }: {
  view: MapProjectView; georeference: MapGeoreference; bounds: Bounds | undefined;
  areas: readonly { areaId: string; name: string; polygon: readonly (readonly Point[])[] }[];
  layers: ReturnType<typeof useMapProjectLayers>; control: ReturnType<typeof useMapProjectControlPoints>;
  importer: ReturnType<typeof useMapProjectImport>; symbols: ReadonlyMap<string, CatalogSymbol>; work: ReturnType<typeof useMapProjectWorkLayers>;
  /** Guiden: starta «Dela med ett streck» för en del eller hela kartområdet (bara för den som får dela). */
  onSplit: ((areaId: string | undefined) => void) | undefined;
}) {
  const steps = useTexts(mapUnderlayStepsSv, mapUnderlayStepsEn);
  // Körningarna och uppgifterna läses en gång och delas av guiden och laserpanelen.
  const laser = useMapProjectLaser({ view, layers, importer, georeference, bounds, areas });
  // Ägaren 2026-11-12: i den ordning man arbetar. Översynen av kartstegen 2026-11-17: tre numrerade huvudsteg (h3) med det som
  // hör till steget indraget under – 1 hämta underlag, 2 ta fram grundkartan (guiden först, andra sätt under), 3 gå igenom utkastet.
  return <MapProjectLayersPanel layers={layers} mapEpsg={georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined}
    control={control} scale={georeference.scale} area={bounds} intro={steps.intro}
    step={body => <MapProjectStep number={1} title={steps.sources} help={steps.sourcesHelp} label={steps.step(1)} testId="map-project-mapstep-sources">
      {body}</MapProjectStep>}
    sources={<>
      <MapProjectOrthoPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectWmsPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectMoisturePanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectForestImagePanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} importer={importer} />
      {importer.canImport && <MapProjectFolderIntake projectId={view.projectId} georeference={georeference} bounds={bounds} layers={layers} work={work} />}
    </>}
    after={<>
      <MapProjectStep number={2} title={steps.baseMap} help={steps.baseMapHelp} label={steps.step(2)} testId="map-project-mapstep-base-map">
        <MapProjectGuide view={view} laser={laser} importer={importer} areas={areas} onSplit={onSplit} />
        <h4 className={styles.groupTitle}>{steps.baseMapOther}</h4>
        <MapProjectLaserPanel view={view} laser={laser} importer={importer} georeference={georeference} bounds={bounds} areas={areas} />
        {importer.canImport && <MapProjectImportPanel importer={importer} symbols={symbols} areas={areas} />}
        {/* Ägaren 2026-11-16: för den som ritar själv – ladda ner underlaget i stället för att läsa in ett utkast. */}
        {importer.canImport && <MapProjectDrawingBasisPanel view={view} layers={layers} />}
      </MapProjectStep>
      <MapProjectStep number={3} title={steps.adjust} help={steps.adjustHelp} label={steps.step(3)} testId="map-project-mapstep-review">
      <MapProjectKnollPanel view={view} importer={importer} />
      <MapProjectHillPanel importer={importer} />
      <MapProjectPitPanel importer={importer} />
      <MapProjectCliffPanel view={view} importer={importer} scale={georeference.scale} />
      <MapProjectFlatPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectClearPanel view={view} importer={importer} />
      <MapProjectGreenPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectDepthPanel view={view} bounds={bounds} layers={layers} georeference={georeference} importer={importer} />
      <MapProjectRockPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectClearCutPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} importer={importer} />
      <MapProjectPhotoPanel layers={layers} georeference={georeference} importer={importer} />
      </MapProjectStep>
      <p className={styles.then} data-testid="map-project-steps-then">{steps.then}</p>
    </>} />;
}
