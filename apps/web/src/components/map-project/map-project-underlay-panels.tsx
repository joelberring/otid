"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference, Point } from "@o-tid/map-file";
import type { Bounds } from "../../lib/course-setting-viewport";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { MapProjectDepthPanel, MapProjectGreenPanel, MapProjectRockPanel } from "./map-project-slider-panels";
import { MapProjectFolderIntake } from "./map-project-folder-intake";
import { MapProjectGuide } from "./map-project-guide";
import { MapProjectClearCutPanel, MapProjectForestImagePanel } from "./map-project-forest-panels";
import { MapProjectImportPanel } from "./map-project-import-panel";
import { MapProjectPrimarySources } from "./map-project-primary";
import { MapProjectLaserPanel } from "./map-project-laser-panel";
import { MapProjectPhotoPanel } from "./map-project-photo-panel";
import { MapProjectPhotoFillPanel } from "./map-project-photo-fill-panel";
import type { useMapProjectPhotoFill } from "./use-map-project-photo-fill";
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
import type { useMapProjectImport } from "./use-map-project-import";
import { useMapProjectLaser } from "./use-map-project-laser";
import type { useMapProjectLayers } from "./use-map-project-layers";
import type { useMapProjectWorkLayers } from "./use-map-project-work-layers";

/**
 * Fliken Grundkarta (översynen av första kartan 2026-11-17, K1; tidigare under Lager): arbetsgången för en ny karta i tre numrerade
 * steg – 1 hämta underlag (valfritt), 2 ta fram grundkartan (guiden, med laserkörningarna som en utfällning sist i guiden, K2;
 * sedan «Andra sätt»), 3 gå igenom utkastet – och en rad om vad som kommer sedan. Underlagen själva ligger under Lager.
 */
export function MapProjectBaseMapPanel({ view, georeference, bounds, areas, layers, importer, symbols, work, photoFill, onSplit, onAreas, onDraw }: {
  view: MapProjectView; georeference: MapGeoreference; bounds: Bounds | undefined;
  areas: readonly { areaId: string; name: string; polygon: readonly (readonly Point[])[] }[];
  layers: ReturnType<typeof useMapProjectLayers>;
  importer: ReturnType<typeof useMapProjectImport>; symbols: ReadonlyMap<string, CatalogSymbol>; work: ReturnType<typeof useMapProjectWorkLayers>;
  /** Fyll ytor ur flygbilden (ägaren 2026-11-23). */
  photoFill: ReturnType<typeof useMapProjectPhotoFill>;
  /** Guiden: starta «Dela med ett streck» för en del eller hela kartområdet (bara för den som får dela). */
  onSplit: ((areaId: string | undefined) => void) | undefined;
  /** Guiden: till Granska › Delområden (K5). */
  onAreas: () => void;
  /** «Rita färdigt»: till fliken Symboler. */
  onDraw: () => void;
}) {
  const steps = useTexts(mapUnderlayStepsSv, mapUnderlayStepsEn);
  // Körningarna och uppgifterna läses en gång och delas av guiden och laserpanelen.
  const laser = useMapProjectLaser({ view, layers, importer, georeference, bounds, areas });
  return <section className={styles.panel} aria-labelledby="map-project-basemap" data-testid="map-project-basemap">
    <h2 id="map-project-basemap">{steps.heading}</h2>
    <p className={styles.muted}>{steps.intro}</p>
    <MapProjectStep number={1} title={steps.sources} help={steps.sourcesHelp} label={steps.step(1)} testId="map-project-mapstep-sources">
      <MapProjectOrthoPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectWmsPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectMoisturePanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectForestImagePanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} importer={importer} />
      {importer.canImport && <MapProjectFolderIntake projectId={view.projectId} georeference={georeference} bounds={bounds} layers={layers} work={work} />}
      <p className={styles.muted} data-testid="map-project-sources-where">{steps.sourcesWhere}</p>
    </MapProjectStep>
    <MapProjectStep number={2} title={steps.baseMap} help={steps.baseMapHelp} label={steps.step(2)} testId="map-project-mapstep-base-map">
      <MapProjectGuide view={view} laser={laser} importer={importer} areas={areas} onSplit={onSplit} onAreas={onAreas} onDraw={onDraw}
        advanced={<MapProjectLaserPanel view={view} laser={laser} importer={importer} georeference={georeference} bounds={bounds} areas={areas} />} />
      {importer.canImport && <>
        <h4 className={styles.groupTitle}>{steps.baseMapOther}</h4>
        <MapProjectImportPanel importer={importer} symbols={symbols} areas={areas} />
        <MapProjectPrimarySources importer={importer} />
        {/* Ägaren 2026-11-16: för den som ritar själv – ladda ner underlaget i stället för att läsa in ett utkast. */}
        <MapProjectDrawingBasisPanel view={view} layers={layers} />
      </>}
    </MapProjectStep>
    <MapProjectStep number={3} title={steps.adjust} help={steps.adjustHelp} label={steps.step(3)} testId="map-project-mapstep-review">
      <MapProjectKnollPanel view={view} importer={importer} scale={georeference.scale} />
      <MapProjectHillPanel importer={importer} />
      <MapProjectPitPanel importer={importer} />
      <MapProjectCliffPanel view={view} importer={importer} scale={georeference.scale} />
      <MapProjectFlatPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectClearPanel view={view} importer={importer} />
      <MapProjectGreenPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectDepthPanel view={view} bounds={bounds} layers={layers} georeference={georeference} importer={importer} />
      <MapProjectRockPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectClearCutPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} importer={importer} />
      <MapProjectPhotoPanel view={view} layers={layers} georeference={georeference} importer={importer} />
      <MapProjectPhotoFillPanel photo={photoFill} projectName={view.name} canEdit={view.viewer.canEdit || view.viewer.canPropose} />
    </MapProjectStep>
    <p className={styles.then} data-testid="map-project-steps-then">{steps.then}</p>
  </section>;
}

/** K6 (översynen av första kartan): magnetisk nord och kartans färger sist under Lager, i en stängd utfällning, så att de inte ser ut som ett steg. */
export function MapProjectSettingsDetails({ children }: { children: ReactNode }) {
  const steps = useTexts(mapUnderlayStepsSv, mapUnderlayStepsEn);
  return <details className={styles.settings} data-testid="map-project-map-settings">
    <summary>{steps.settings}</summary>
    <p className={styles.muted}>{steps.settingsHelp}</p>
    {children}
  </details>;
}

/** K3 (översynen av första kartan): exporten nås från redigeraren, sist i Granska efter normkontrollen. */
export function MapProjectToExport({ projectId }: { projectId: string }) {
  const steps = useTexts(mapUnderlayStepsSv, mapUnderlayStepsEn);
  return <section className={styles.panel} aria-label={steps.toExport} data-testid="map-project-to-export">
    <p className={styles.muted}>{steps.toExportHelp}</p>
    <Link className={styles.exportLink} href={`/organizer/map-projects/${encodeURIComponent(projectId)}#exportera`} data-testid="map-project-to-export-link">
      {steps.toExport}</Link>
  </section>;
}
