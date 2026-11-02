import { writeIofCourseData, type CourseSettingDocument, type MapRect } from "@o-tid/course-setting";
import { isSupportedEpsg, mapPointToWgs84, type MapGeoreference } from "@o-tid/map-file";

/**
 * ADR-0190 beslut 5: "Ladda ned IOF XML (banor)" i banläggningens Fil-meny. Kartfilens yta och, när kartfilen är
 * georefererad i ett koordinatsystem som O-Tid kan räkna om, kontrollernas lägen i WGS 84 (som Purple Pen skriver dem).
 */
export function iofCourseFile(document: CourseSettingDocument, options: { mapBounds?: MapRect | undefined;
  georeference?: MapGeoreference | null | undefined; now?: Date | undefined } = {}): { fileName: string; xml: string } {
  const georeference = options.georeference && options.georeference.crs.kind === "EPSG" && isSupportedEpsg(options.georeference.crs.code)
    ? options.georeference : undefined;
  const position = georeference ? (at: { x: number; y: number }) => {
    const { latitude, longitude } = mapPointToWgs84(georeference, at);
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : undefined;
  } : undefined;
  const xml = writeIofCourseData(document, { mapBounds: options.mapBounds, position, createTime: options.now });
  const title = document.event.title.trim().replace(/[^\p{L}\p{N} ._-]/gu, "_") || "banor";
  return { fileName: `${title} IOF.xml`, xml };
}
