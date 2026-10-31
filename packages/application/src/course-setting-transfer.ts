import { courseVariants, type ControlPoint, type CourseSettingDocument } from "@o-tid/course-setting";
import { courseVariantCode, type CourseImport, type GeoPosition, type MapPositionImport } from "@o-tid/iof-xml";
import { isSupportedEpsg, mapPointToWgs84, type MapGeoreference, type Point } from "@o-tid/map-file";
import type { CourseFileProjection } from "./source-sync-model";

/**
 * Steg 62 (ADR-0180 beslut 1, 6): banläggningens dokument som en banfil, så att "Överför till tävlingen" går genom samma
 * jämförelse och tillämpning som en uppladdad IOF XML (`diffCourseFile`). Resultatet ska vara detsamma som om banläggaren
 * exporterat IOF XML 3.0 ur Purple Pen och läst in den (`ExportXmlVersion3` i Purple Pen, BSD):
 *
 * - bara banor med start och mål, i banlistans ordning; en ogafflad bana heter som i dokumentet (filen har inget Id)
 * - en gafflad bana blir en familj (`family:Namn`) med en variant per Purple Pen-kod ("Lång ACEG" → "ACEG")
 * - längden avrundad till 100 m (inskriven längd går före), stigningen till 5 m
 * - klasserna ur banans undertitel ("H21, D21"), startregel PUNCH som vid en inläst banfil
 * - kartlägen (mm, två decimaler), kartans skala och – när kartfilen är georefererad – lägen i WGS 84.
 *
 * Stafettlagens varianter (Purple Pens `relay-teams`) förs inte över än; de läses in med en startlista eller IOF XML.
 */
export type CourseSettingTransferProblem = { readonly error: "NO_COURSES" | "INVALID_CODES"; readonly controls: readonly string[] };

const CODE = /^[1-9][0-9]{0,5}$/;
const round2 = (value: number) => Math.round(value * 100) / 100;
const mapPosition = (at: Point): MapPositionImport => ({ x: round2(at.x), y: round2(at.y) });

/** Kartfilens georeferens när O-Tid kan räkna om dess koordinatsystem (samma som vägvalen). */
export function usableGeoreference(georeference: MapGeoreference | null | undefined): MapGeoreference | undefined {
  return georeference && georeference.crs.kind === "EPSG" && isSupportedEpsg(georeference.crs.code) ? georeference : undefined;
}

function geoPosition(georeference: MapGeoreference | undefined, at: Point): GeoPosition | undefined {
  if (!georeference) return undefined;
  const { latitude, longitude } = mapPointToWgs84(georeference, at);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : undefined;
}

/** Purple Pen: längden avrundad till närmaste 100 m; 0 m räknas som saknad (som vid inläsningen). */
const roundedLength = (meters: number | undefined) => meters === undefined || !Number.isFinite(meters) ? undefined
  : Math.round(meters / 100) * 100 || undefined;
const roundedClimb = (meters: number | undefined) => meters === undefined || !(meters > 0) ? undefined : Math.round(meters / 5) * 5;

/** Klasserna i banans undertitel, åtskilda med komma eller lodstreck (Purple Pens `GetClassNames`). */
export function classNamesOf(secondaryTitle: string | undefined): string[] {
  return (secondaryTitle ?? "").split(/[,|]/).map(name => name.trim()).filter(name => name.length > 0);
}

export function courseSettingProjection(document: CourseSettingDocument, options: { readonly georeference?: MapGeoreference | undefined } = {})
  : { readonly projection: CourseFileProjection } | { readonly problem: CourseSettingTransferProblem } {
  const georeference = usableGeoreference(options.georeference);
  const control = (courseControl: string): ControlPoint | undefined => {
    const id = document.courseControls[courseControl]?.control;
    return id === undefined ? undefined : document.controls[id];
  };
  const invalid = new Set<string>();
  const courses: CourseImport[] = [];
  const assignments: CourseFileProjection["data"]["assignments"][number][] = [];
  const assigned = new Set<string>();
  const ordered = [...document.courses].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "sv-SE"));

  for (const course of ordered) {
    const variants = courseVariants(document, course.id);
    const first = variants[0];
    if (!first) continue;
    const points = first.courseControls.map(control).filter((point): point is ControlPoint => point !== undefined);
    const start = points.find(point => point.kind === "START");
    const finish = [...points].reverse().find(point => point.kind === "FINISH");
    if (!start || !finish) continue;
    const measured = variants.map(variant => {
      const codes = variant.courseControls.map(control).filter(point => point?.kind === "NORMAL").map(point => {
        if (!point!.code || !CODE.test(point!.code)) { invalid.add(point!.id); return 0; }
        return Number(point!.code);
      });
      return { code: variant.code, controlCodes: codes, lengthMeters: roundedLength(course.lengthOverrideMeters ?? variant.lengthMeters) };
    });
    const ends = { startMapPosition: mapPosition(start.at), finishMapPosition: mapPosition(finish.at),
      ...(geoPosition(georeference, start.at) ? { startPosition: geoPosition(georeference, start.at)! } : {}),
      ...(geoPosition(georeference, finish.at) ? { finishPosition: geoPosition(georeference, finish.at)! } : {}) };
    const climbMeters = roundedClimb(course.climbMeters);
    const forked = variants.length > 1 || first.code !== "";
    let externalId = course.name;
    if (forked) {
      externalId = `family:${course.name}`;
      const longest = [...measured].sort((left, right) => (right.lengthMeters ?? 0) - (left.lengthMeters ?? 0))[0];
      courses.push({ externalId, name: course.name, controlCodes: [], ...ends,
        variants: measured.map(variant => ({ code: courseVariantCode(course.name, `${course.name} ${variant.code}`), controlCodes: variant.controlCodes,
          ...(variant.lengthMeters !== undefined ? { lengthMeters: variant.lengthMeters } : {}) })),
        ...(longest?.lengthMeters !== undefined ? { lengthMeters: longest.lengthMeters } : {}), ...(climbMeters !== undefined ? { climbMeters } : {}) });
    } else {
      courses.push({ externalId, name: course.name, controlCodes: measured[0]!.controlCodes, ...ends,
        ...(measured[0]!.lengthMeters !== undefined ? { lengthMeters: measured[0]!.lengthMeters } : {}),
        ...(climbMeters !== undefined ? { climbMeters } : {}) });
    }
    // Inläsningen ger varje klass den första banan som nämner den.
    for (const className of classNamesOf(course.secondaryTitle)) {
      if (assigned.has(className)) continue;
      assigned.add(className);
      assignments.push({ classExternalId: className, className, courseExternalId: externalId, startRule: "PUNCH" });
    }
  }
  if (invalid.size > 0) return { problem: { error: "INVALID_CODES", controls: [...invalid].slice(0, 200) } };
  if (courses.length === 0) return { problem: { error: "NO_COURSES", controls: [] } };

  // Alla vanliga kontroller med kod, även de som ingen bana använder (Purple Pen skriver alla), första läget per kod.
  const controlPositions: ({ code: number } & GeoPosition)[] = [];
  const controlMapPositions: ({ code: number } & MapPositionImport)[] = [];
  const seen = new Set<number>();
  const ids = Object.keys(document.controls).sort((left, right) => left.localeCompare(right, "sv-SE", { numeric: true }));
  for (const id of ids) {
    const point = document.controls[id]!;
    if (point.kind !== "NORMAL" || !point.code || !CODE.test(point.code) || seen.has(Number(point.code))) continue;
    const code = Number(point.code);
    seen.add(code);
    controlMapPositions.push({ code, ...mapPosition(point.at) });
    const geo = geoPosition(georeference, point.at);
    if (geo) controlPositions.push({ code, ...geo });
  }
  const warnings = assignments.length > 0 ? ["Startregel saknas i IOF CourseData 3.0; PUNCH används tills en separat StartList importeras"]
    : ["Inga ClassCourseAssignment hittades"];
  return { projection: { kind: "COURSE_FILE", data: { courses, assignments, legAssignments: [], personAssignments: [], teamAssignments: [],
    controlPositions, ...(controlMapPositions.length > 0 ? { controlMapPositions } : {}), mapScale: Math.round(document.event.mapScale), warnings } } };
}
