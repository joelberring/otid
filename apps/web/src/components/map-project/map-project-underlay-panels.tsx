"use client";

import type { MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference, Point } from "@o-tid/map-file";
import type { Bounds } from "../../lib/course-setting-viewport";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { MapProjectDepthPanel, MapProjectGreenPanel } from "./map-project-slider-panels";
import { MapProjectFolderIntake } from "./map-project-folder-intake";
import { MapProjectClearCutPanel, MapProjectForestImagePanel } from "./map-project-forest-panels";
import { MapProjectImportPanel } from "./map-project-import-panel";
import { MapProjectLaserPanel } from "./map-project-laser-panel";
import { MapProjectLayersPanel } from "./map-project-layers-panel";
import { MapProjectPhotoPanel } from "./map-project-photo-panel";
import { MapProjectMoisturePanel } from "./map-project-moisture-panel";
import { MapProjectOrthoPanel } from "./map-project-ortho-panel";
import type { useMapProjectControlPoints } from "./use-map-project-control-points";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import type { useMapProjectWorkLayers } from "./use-map-project-work-layers";

/**
 * Underlagen i editorns sidopanel (översynen 2026-11-10 G1: utbrutet ur `map-project-editor.tsx`): bilderna med passpunkter,
 * ortofoto, markfuktighet, laser, vektorimporten och mappen med äldre underlag. Bara när kartan har en georeferens.
 */
export function MapProjectUnderlayPanels({ view, georeference, bounds, areas, layers, control, importer, symbols, work }: {
  view: MapProjectView; georeference: MapGeoreference; bounds: Bounds | undefined;
  areas: readonly { areaId: string; name: string; polygon: readonly (readonly Point[])[] }[];
  layers: ReturnType<typeof useMapProjectLayers>; control: ReturnType<typeof useMapProjectControlPoints>;
  importer: ReturnType<typeof useMapProjectImport>; symbols: ReadonlyMap<string, CatalogSymbol>; work: ReturnType<typeof useMapProjectWorkLayers>;
}) {
  return <MapProjectLayersPanel layers={layers} mapEpsg={georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined}
    control={control} scale={georeference.scale} area={bounds}
    after={<>
      <MapProjectOrthoPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectPhotoPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectMoisturePanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} />
      <MapProjectForestImagePanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} importer={importer} />
      <MapProjectClearCutPanel view={view} layers={layers} georeference={georeference} bounds={bounds} areas={areas} importer={importer} />
      <MapProjectDepthPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectGreenPanel layers={layers} georeference={georeference} importer={importer} />
      <MapProjectLaserPanel view={view} layers={layers} importer={importer} georeference={georeference} bounds={bounds} areas={areas} />
      {importer.canImport && <MapProjectImportPanel importer={importer} symbols={symbols} areas={areas} />}
      {importer.canImport && <MapProjectFolderIntake projectId={view.projectId} georeference={georeference} bounds={bounds} layers={layers} work={work} />}
    </>} />;
}
